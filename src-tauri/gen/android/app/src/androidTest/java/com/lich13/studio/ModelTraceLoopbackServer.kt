package com.lich13.studio

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Local Responses SSE fixture for Android instrumentation; it accepts loopback traffic only. */
internal class LoopbackModelTraceServer(private val expectedApiKey: String) : Closeable {
    companion object {
        // Seed 208, weighted from bundled gpt-5.4 counts; fingerprintCore scores one group at 0.9999995267.
        const val SAMPLE = "6 90 199 109 124 349 79 312 225 11 214 334 29 162 304 72 212 343 157 37 139 194 227 167 52 224 340 40 48 188 252 205 244 199 130 65 290 336 18 161 86 26 73 3 205 198 150 22 105 295 13 157 196 286 45 240 105 49 93 97 347 273 348 237 65 208 23 348 51 266 35 307 144 54 90 153 129 197 168 288 191 224 135 132 239 132 73 182 40 143 27 228 320 64 22 194 46 227 77 14 107 67 71 216 333 166 62 126 319 256 98 133 256 308 236 156 168 216 118 232 94 296 217 287 159 120 110 234 114 100 123 83 267 53 301 284 53 103 133 338 53 172 313 102 149 67 209 26 47 233 88 213 58 34 62 32 342 140 149 50 99 201 171 332 325 288 248 76 181 343 311 100 301 79 116 170 243 29 47 307 61 293 84 295 340 39 213 343 96 345 207 150 300 53 97 147 132 279 120 321 197 68 278 139 225 95 243 136 260 74 253 126 245 148 76 270 183 214 276 284 157 352 284 80 97 353 138 291 213 304 261 7 274 315 173 244 293 179 151 64 287 11 124 24 161 50 60 288 179 59 303 7 319 10 212 10 157 210 166 228 213 333 232 282 120 92 209 76 62 109 15 227 142 133 226 142 340 131 306 156 133 20 316 158 66 21 284 285 15 171 89 82 69 162 43 179 70 71 239 151 319 129 341"
    }

    private val closed = AtomicBoolean(false)
    private val requests = AtomicInteger(0)
    private val preflights = AtomicInteger(0)
    private val socket = ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 4)
        soTimeout = 250
    }
    @Volatile var failure: Throwable? = null
        private set
    @Volatile var lastPath: String? = null
        private set
    @Volatile var requestedModel: String? = null
        private set
    @Volatile var authorizationMatches: Boolean = false
        private set
    val port: Int get() = socket.localPort
    val postCount: Int get() = requests.get()
    val preflightCount: Int get() = preflights.get()

    private val worker = Thread({ serve() }, "modeltrace-loopback-fixture").apply {
        isDaemon = true
        start()
    }

    private fun serve() {
        while (!closed.get()) {
            val accepted = try {
                socket.accept()
            } catch (_: SocketTimeoutException) {
                continue
            } catch (error: Throwable) {
                if (!closed.get()) failure = error
                return
            }
            try {
                accepted.use { handle(it) }
            } catch (error: Throwable) {
                if (!closed.get()) failure = error
            }
        }
    }

    private fun handle(client: Socket) {
        client.soTimeout = 10_000
        val input = client.getInputStream()
        val requestLine = readLine(input) ?: return
        val fields = requestLine.split(' ')
        val method = fields.getOrNull(0).orEmpty()
        val path = fields.getOrNull(1).orEmpty()
        val headers = linkedMapOf<String, String>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator > 0) headers[line.substring(0, separator).trim().lowercase()] =
                line.substring(separator + 1).trim()
        }
        if (method.equals("OPTIONS", ignoreCase = true)) {
            preflights.incrementAndGet()
            writeResponse(client, "204 No Content", "", ByteArray(0), headers)
            return
        }
        if (!method.equals("POST", ignoreCase = true)) {
            writeResponse(client, "405 Method Not Allowed", "text/plain", ByteArray(0), headers)
            return
        }
        lastPath = path
        val body = readRequestBody(input, headers)
        val request = runCatching { JSONObject(String(body, StandardCharsets.UTF_8)) }.getOrNull()
        requestedModel = request?.optString("model")
        authorizationMatches = headers["authorization"] == "Bearer " + expectedApiKey
        requests.incrementAndGet()
        writeResponse(client, "200 OK", "text/event-stream; charset=utf-8", responseEvents(), headers)
    }

    private fun readRequestBody(input: java.io.InputStream, headers: Map<String, String>): ByteArray {
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length > 0) {
            val body = ByteArray(length)
            var offset = 0
            while (offset < body.size) {
                val count = input.read(body, offset, body.size - offset)
                if (count < 0) break
                offset += count
            }
            return if (offset == body.size) body else body.copyOf(offset)
        }
        if (!headers["transfer-encoding"].orEmpty().contains("chunked", ignoreCase = true)) return ByteArray(0)
        val output = ByteArrayOutputStream()
        while (true) {
            val size = readLine(input)?.substringBefore(';')?.trim()?.toIntOrNull(16) ?: break
            if (size == 0) {
                while (!readLine(input).isNullOrEmpty()) Unit
                break
            }
            val chunk = ByteArray(size)
            var offset = 0
            while (offset < size) {
                val count = input.read(chunk, offset, size - offset)
                if (count < 0) break
                offset += count
            }
            output.write(chunk, 0, offset)
            readLine(input)
            if (offset < size) break
        }
        return output.toByteArray()
    }

    private fun readLine(input: java.io.InputStream): String? {
        val line = StringBuilder()
        while (true) {
            val value = input.read()
            if (value < 0) return if (line.isEmpty()) null else line.toString()
            if (value == 10) return line.toString()
            if (value != 13) line.append(value.toChar())
        }
    }

    private fun responseEvents(): ByteArray {
        val separator = 10.toChar().toString() + 10.toChar()
        fun event(value: JSONObject) = "data: " + value.toString() + separator
        val item = JSONObject().put("type", "message").put("id", "msg_loopback").put("phase", "final_answer")
        val frames = listOf(
            JSONObject().put("type", "response.output_item.added").put("output_index", 0).put("item", item),
            JSONObject().put("type", "response.output_text.delta").put("item_id", "msg_loopback").put("delta", SAMPLE),
            JSONObject().put("type", "response.output_item.done").put("output_index", 0).put("item", item),
            JSONObject().put(
                "type",
                "response.completed"
            ).put("response", JSONObject().put("usage", JSONObject().put("input_tokens", 10).put("output_tokens", 303)))
        )
        return frames.joinToString(separator = "") { event(it) }.toByteArray(StandardCharsets.UTF_8)
    }

    private fun writeResponse(
        client: Socket,
        status: String,
        contentType: String,
        body: ByteArray,
        requestHeaders: Map<String, String>
    ) {
        val crlf = 13.toChar().toString() + 10.toChar()
        val allowedHeaders = requestHeaders["access-control-request-headers"]
            ?.takeIf { it.length <= 2048 }
            ?: "authorization, content-type, openai-beta"
        val headers = buildString {
            append("HTTP/1.1 ").append(status).append(crlf)
            append("Content-Length: ").append(body.size).append(crlf)
            append("Connection: close").append(crlf)
            append("Access-Control-Allow-Origin: *").append(crlf)
            append("Access-Control-Allow-Methods: POST, OPTIONS").append(crlf)
            append("Access-Control-Allow-Headers: ").append(allowedHeaders).append(crlf)
            append("Access-Control-Max-Age: 3600").append(crlf)
            if (contentType.isNotEmpty()) append("Content-Type: ").append(contentType).append(crlf)
            append(crlf)
        }.toByteArray(StandardCharsets.UTF_8)
        val output = client.getOutputStream()
        output.write(headers)
        output.write(body)
        output.flush()
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) socket.close()
        try {
            worker.join(2_000)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }
}
