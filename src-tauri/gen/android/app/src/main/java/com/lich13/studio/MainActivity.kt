package com.lich13.studio

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.lang.ref.WeakReference

private const val WRY_ACTIVITY_ID_KEY = "__wryActivityId"
private const val MAX_IMPORT_QUEUE = 8
private const val MAX_IMPORT_LINK_LENGTH = 8192
private const val REJECTED_IMPORT_MARKER = "ccswitch://v1/import?lich13studioRejected=limit"

class MainActivity : TauriActivity() {
    companion object {
        init { System.loadLibrary("lich13studio_lib") }
        var web = WeakReference<WebView>(null)
        private var initialActivityCreated = false
        private var lastActivityId = 0
        private val configChangeIds = HashSet<Int>()
        private val pendingImportsLock = Any()
        private val pendingImports = ArrayDeque<String>()
        private var pendingImportOverflow = false
        @JvmStatic private external fun recreateMainWindow()
        @JvmStatic private external fun notifyProviderImportPending()
        @JvmStatic private external fun notifyBackPressed(): Boolean

        @JvmStatic
        fun enqueueProviderImport(raw: String): Boolean {
            val link = raw.trim()
            if (!link.startsWith("ccswitch:", ignoreCase = true)) return false
            synchronized(pendingImportsLock) {
                if (link == REJECTED_IMPORT_MARKER || link.length > MAX_IMPORT_LINK_LENGTH || pendingImports.size >= MAX_IMPORT_QUEUE) {
                    pendingImportOverflow = true
                } else if (!pendingImports.contains(link)) {
                    pendingImports.addLast(link)
                }
            }
            return true
        }

        @JvmStatic
        fun takePendingImports(): List<String> = synchronized(pendingImportsLock) {
            val out = ArrayList<String>(pendingImports.size + 1)
            out.addAll(pendingImports)
            pendingImports.clear()
            if (pendingImportOverflow) {
                out.add(REJECTED_IMPORT_MARKER)
                pendingImportOverflow = false
            }
            out
        }
    }
    private var keyboardOpen = false
    private var activityWeb = WeakReference<WebView>(null)
    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val activeWeb = activityWeb.get()
            if (activeWeb == null || web.get() !== activeWeb || !activeWeb.isAttachedToWindow || !notifyBackPressed()) {
                moveTaskToBack(true)
            }
        }
    }
    private fun consumeDeepLinkIntent(incoming: Intent?) {
        val data = incoming?.dataString
        if (data != null && data.startsWith("ccswitch:", ignoreCase = true)) {
            incoming.data = null
            intent?.data = null
            if (enqueueProviderImport(data)) {
                notifyProviderImportPending()
            }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        consumeDeepLinkIntent(intent)
        val savedId = if (savedInstanceState?.containsKey(WRY_ACTIVITY_ID_KEY) == true) {
            savedInstanceState.getInt(WRY_ACTIVITY_ID_KEY)
        } else {
            null
        }
        val isConfigRecreate = savedId != null && configChangeIds.remove(savedId)
        val needsMainWindow = initialActivityCreated && !isConfigRecreate
        initialActivityCreated = true
        if (needsMainWindow) {
            savedInstanceState?.remove(WRY_ACTIVITY_ID_KEY)
            var nextId = System.identityHashCode(this)
            if (nextId == lastActivityId || nextId == 0) {
                nextId = nextId xor 0x40000001
            }
            intent?.putExtra(WRY_ACTIVITY_ID_KEY, nextId)
        }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, backCallback)
        if (needsMainWindow) {
            intent?.removeExtra(WRY_ACTIVITY_ID_KEY)
            recreateMainWindow()
        }
        lastActivityId = id
    }
    override fun onNewIntent(intent: Intent) {
        consumeDeepLinkIntent(intent)
        super.onNewIntent(intent)
        intent.data = null
        setIntent(Intent(this, MainActivity::class.java))
    }
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        activityWeb = WeakReference(webView)
        web = WeakReference(webView)
        backCallback.remove()
        onBackPressedDispatcher.addCallback(this, backCallback)
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        webView.post {
            if (isFinishing || isDestroyed) return@post
            val container = webView.parent as? ViewGroup ?: return@post
            ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
                val open = insets.isVisible(WindowInsetsCompat.Type.ime())
                if (open != keyboardOpen && !isFinishing && !isDestroyed && webView.isAttachedToWindow) {
                    keyboardOpen = open
                    webView.evaluateJavascript("document.documentElement.dataset.keyboard='${if (open) "open" else "closed"}'", null)
                }
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(container)
        }
    }
    override fun onDestroy() {
        if (isChangingConfigurations) {
            configChangeIds.add(id)
        } else {
            configChangeIds.remove(id)
        }
        val localWeb = activityWeb.get()
        activityWeb.clear()
        val currentWeb = web.get()
        val ownsActiveWebView = currentWeb == null || currentWeb === localWeb || currentWeb.context === this
        if (ownsActiveWebView) {
            currentWeb?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_WAIVED, true)
            (currentWeb?.parent as? ViewGroup)?.let { ViewCompat.setOnApplyWindowInsetsListener(it, null) }
            web.clear()
            BackgroundService.stopAll(this, if (isFinishing) "app-exit" else "renderer-destroyed")
        }
        super.onDestroy()
    }
}
