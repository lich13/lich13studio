"""Loopback-only Android acceptance fixture; never included in app resources."""
import argparse
import json
import re
import select
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
STATE = {"mode": "normal", "requests": [], "active": 0, "peak": 0}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_): pass
    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == "/metrics":
            with LOCK: self.send_json(STATE)
            return
        if self.path == "/pixel.png":
            import base64
            body = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fS8AAAAASUVORK5CYII=")
            self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        links = []
        for app, name, model in [("codex", "Android Responses", "gpt-6.1-sol"), ("grokbuild", "Android grok", "grok-4.6"), ("claude", "Android Anthropic", "claude-sonnet-5-5")]:
            query = urllib.parse.urlencode(dict(resource="provider", app=app, name=name, model=model, endpoint=f"http://127.0.0.1:{self.server.server_port}//v1/v1", apiKey="android-fixture-key"))
            links.append(f'<p><a href="ccswitch://v1/import?{query}">{name}</a></p>')
        for app, name, models in [
            ("codex", "Responses add model", {"model": "gpt-6-sol"}),
            ("claude", "New API models", {"model": "claude-sonnet-5-5", "haikuModel": "claude-haiku-4-5", "sonnetModel": "claude-sonnet-4-6", "opusModel": "claude-opus-4-7"}),
        ]:
            query = urllib.parse.urlencode(dict(resource="provider", app=app, name=name, endpoint=f"http://127.0.0.1:{self.server.server_port}//v1/v1", apiKey="android-fixture-key", **models))
            links.append(f'<p><a href="ccswitch://v1/import?{query}">{name}</a></p>')
        links.append('<p><a href="ccswitch://v1/import?resource=provider&app=gemini&apiKey=android-fixture-key&endpoint=https%3A%2F%2Fexample.invalid">Invalid import</a></p>')
        body = ('<!doctype html><meta name="viewport" content="width=device-width"><title>Android import fixture</title><style>a{display:block;padding:20px;font:20px sans-serif}</style>' + ''.join(links)).encode()
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        if self.path == "/mode":
            with LOCK:
                if STATE["active"]: self.send_json({"error": "Requests still active"}, 409); return
                STATE.update(mode=body.get("mode", "normal"), requests=[], peak=0)
            self.send_json({"ok": True}); return
        if self.path not in ("/v1/responses", "/v1/messages"):
            self.send_json({"error": {"message": "Unexpected path"}}, 400); return
        raw = json.dumps(body, ensure_ascii=False)
        challenge = "355" in raw and ("整数" in raw or "integer" in raw)
        entry = {"path": self.path, "model": body.get("model"), "ua": self.headers.get("User-Agent"), "authorized": self.headers.get("Authorization") == "Bearer android-fixture-key" or self.headers.get("x-api-key") == "android-fixture-key", "test": challenge, "reasoning": any(key in body for key in ("reasoning", "thinking", "output_config")), "tools": bool(body.get("tools")), "maxTokens": body.get("max_output_tokens", body.get("max_tokens")), "image": "input_image" in raw or '"type": "image"' in raw, "completed": False, "closed": False}
        with LOCK:
            mode = STATE["mode"]; count = len(STATE["requests"]); STATE["requests"].append(entry)
            STATE["active"] += 1; STATE["peak"] = max(STATE["peak"], STATE["active"])
        try:
            if mode == "fatal": self.send_json({"error": {"message": "Invalid API key", "type": "authentication_error"}}, 401); return
            if mode == "retry" and count == 0: self.send_json({"error": {"message": "Temporary fixture failure"}}, 503); return
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "close"); self.end_headers()
            n = re.search(r"(?:选择|输出|choose|generate)\s*(\d{2,3})\s*(?:个|integers)", raw, re.I)
            count_numbers = int(n.group(1)) if n else 320
            text = ','.join(str((index * 83 + 137) % 355 + 1) for index in range(count_numbers)) if challenge else "ANDROID_STREAM_OK 图片和文本请求已收到。"
            if mode == "limit": text = ','.join('1' for _ in range(3000))
            if mode in ("slow", "cancel"): self.delay(25 if mode == "slow" else 120)
            if self.path.endswith("responses"): self.stream_responses(text, body.get("model", "fixture"), mode)
            else: self.anthropic(text, body.get("model", "fixture"), mode)
            entry["completed"] = True
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError): pass
        finally:
            with LOCK: entry["closed"] = True; STATE["active"] -= 1
            self.close_connection = True
    def delay(self, seconds):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            ready, _, _ = select.select([self.connection], [], [], min(.1, max(0, until-time.monotonic())))
            if ready and not self.connection.recv(1, socket.MSG_PEEK): raise BrokenPipeError()
    def event(self, event, payload):
        self.wfile.write((f"event: {event}\r\ndata: {json.dumps(payload, ensure_ascii=False)}\r\n\r\n").encode()); self.wfile.flush()
    def stream_responses(self, text, model, mode):
        response = {"id": "resp_fixture", "object": "response", "created_at": int(time.time()), "model": model, "status": "in_progress", "output": []}
        item = {"id": "msg_fixture", "type": "message", "role": "assistant", "status": "in_progress", "content": []}
        def emit(name, **data): self.event(name, {"type": name, **data})
        emit("response.created", response=response)
        emit("response.output_item.added", output_index=0, item=item)
        emit("response.content_part.added", item_id=item["id"], output_index=0, content_index=0, part={"type": "output_text", "text": "", "annotations": []})
        for offset in range(0, len(text), 7):
            emit("response.output_text.delta", item_id=item["id"], output_index=0, content_index=0, delta=text[offset:offset+7])
            if mode == "disconnect" and offset > 20: self.connection.shutdown(socket.SHUT_RDWR); raise ConnectionResetError()
            self.delay(.015)
        part = {"type": "output_text", "text": text, "annotations": []}
        emit("response.output_text.done", item_id=item["id"], output_index=0, content_index=0, text=text)
        emit("response.content_part.done", item_id=item["id"], output_index=0, content_index=0, part=part)
        item.update(status="completed", content=[part])
        emit("response.output_item.done", output_index=0, item=item)
        response.update(status="completed", output=[item], usage={"input_tokens": 10, "output_tokens": len(text)//2, "total_tokens": 10+len(text)//2})
        emit("response.completed", response=response)
    def anthropic(self, text, model, mode):
        self.event("message_start", {"type": "message_start", "message": {"id": "msg_fixture", "type": "message", "role": "assistant", "model": model, "content": [], "usage": {"input_tokens": 10, "output_tokens": 0}}})
        self.event("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        for offset in range(0, len(text), 7):
            self.event("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text[offset:offset+7]}}); self.delay(.015)
        self.event("content_block_stop", {"type": "content_block_stop", "index": 0})
        self.event("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": len(text)//2}})
        self.event("message_stop", {"type": "message_stop"})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=18765); args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Android fixture listening on 127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
