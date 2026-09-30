package com.lich13.studio

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {
    companion object { var web = WeakReference<WebView>(null) }
    private var keyboardOpen = false
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // The deep-link plugin has received the Intent; don't retain its Key.
        intent.data = null
        setIntent(Intent(this, MainActivity::class.java))
    }
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        web = WeakReference(webView)
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        webView.post {
            val container = webView.parent as? ViewGroup ?: return@post
            ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
                val open = insets.isVisible(WindowInsetsCompat.Type.ime())
                if (open != keyboardOpen) {
                    keyboardOpen = open
                    webView.evaluateJavascript("document.documentElement.dataset.keyboard='${if (open) "open" else "closed"}'", null)
                }
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(container)
        }
    }
    override fun onDestroy() {
        if (isFinishing) {
            BackgroundService.stopAll(this, "app-exit")
            web.clear()
        }
        super.onDestroy()
    }
}
