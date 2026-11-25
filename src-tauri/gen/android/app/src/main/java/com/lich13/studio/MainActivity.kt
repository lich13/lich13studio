package com.lich13.studio

import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.lang.ref.WeakReference

private const val WRY_ACTIVITY_ID_KEY = "__wryActivityId"

class MainActivity : TauriActivity() {
    companion object {
        init { System.loadLibrary("lich13studio_lib") }
        var web = WeakReference<WebView>(null)
        private var initialActivityCreated = false
        private var lastActivityId = 0
        private val configChangeIds = HashSet<Int>()
        @JvmStatic private external fun recreateMainWindow()
    }
    private var keyboardOpen = false
    override fun onCreate(savedInstanceState: Bundle?) {
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
        if (needsMainWindow) {
            intent?.removeExtra(WRY_ACTIVITY_ID_KEY)
            recreateMainWindow()
        }
        lastActivityId = id
    }
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        web = WeakReference(webView)
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
        val currentWeb = web.get()
        val ownsActiveWebView = currentWeb == null || currentWeb.context === this
        if (ownsActiveWebView) {
            currentWeb?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_WAIVED, true)
            (currentWeb?.parent as? ViewGroup)?.let { ViewCompat.setOnApplyWindowInsetsListener(it, null) }
            web.clear()
            BackgroundService.stopAll(this, if (isFinishing) "app-exit" else "renderer-destroyed")
        }
        super.onDestroy()
    }
}
