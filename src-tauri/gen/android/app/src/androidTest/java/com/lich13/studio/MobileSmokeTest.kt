package com.lich13.studio

import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import android.accessibilityservice.AccessibilityServiceInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A separate instrumentation APK. No test routes or JS bridges enter the app. */
@RunWith(AndroidJUnit4::class)
class MobileSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun waitFor(label: String, condition: () -> Boolean) {
        val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
        while (System.nanoTime() < until) {
            if (condition()) return
            Thread.sleep(100)
        }
        fail("Timed out: $label")
    }
    private fun js(source: String): Any? {
        val latch = CountDownLatch(1)
        var result: String? = null
        instrumentation.runOnMainSync {
            MainActivity.web.get()?.evaluateJavascript(source) { result = it; latch.countDown() } ?: latch.countDown()
        }
        assertTrue("WebView did not respond", latch.await(10, TimeUnit.SECONDS))
        return result?.let { JSONTokener(it).nextValue() }
    }
    private fun open(url: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    private fun activity(): MainActivity {
        var current: MainActivity? = null
        instrumentation.runOnMainSync {
            current = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().singleOrNull()
        }
        return checkNotNull(current) { "No resumed main activity" }
    }
    private fun allowNotification(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false
        if (node.viewIdResourceName?.endsWith(":id/permission_allow_button") == true) {
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
        for (index in 0 until node.childCount) if (allowNotification(node.getChild(index))) return true
        return false
    }
    private fun verifyNotificationPermission() {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS }
        val needsPrompt = Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        val request = "window.__notificationOutcome='pending';void window.__TAURI_INTERNALS__.invoke('mobile_command',{command:'notificationPermission',args:{request:true}}).then(r=>window.__notificationOutcome=r.granted?'granted':'denied',()=>window.__notificationOutcome='error')"
        js(request)
        if (needsPrompt) waitFor("notification permission dialog") { allowNotification(automation.rootInActiveWindow) }
        waitFor("notification permission callback") { js("window.__notificationOutcome") == "granted" }
        // Repeating an already-granted request must also resolve.
        js(request)
        waitFor("already-granted notification callback") { js("window.__notificationOutcome") == "granted" }
    }
    @Test fun importsUseConfirmationAndPrivateCredentials() {
        val link = Uri.Builder().scheme("ccswitch").authority("v1").appendPath("import")
            .appendQueryParameter("resource", "provider").appendQueryParameter("app", "codex")
            .appendQueryParameter("name", "Android CI provider").appendQueryParameter("endpoint", "http://127.0.0.1:18765//v1/v1")
            .appendQueryParameter("apiKey", "ci-only-model-key").appendQueryParameter("model", "gpt-6.1-sol").build().toString()
        open(link)
        waitFor("cold-start confirmation") { js("!!document.querySelector('.ant-modal input')") == true }
        assertEquals("Android CI provider", js("document.querySelector('.ant-modal input').value"))
        assertEquals(false, js("document.body.innerText.includes('ci-only-model-key')"))
        assertEquals(false, js("JSON.stringify(localStorage).includes('ci-only-model-key')"))
        assertEquals(true, js("document.body.innerText.includes('http://127.0.0.1:18765/v1')"))
        js("document.querySelector('.ant-modal-footer .ant-btn-primary').click()")
        waitFor("protected persistence") { js("JSON.stringify(localStorage).includes('lich13-secret:')") == true }
        assertEquals(false, js("JSON.stringify(localStorage).includes('ci-only-model-key')"))
        val vault = File(context.noBackupFilesDir, "credentials-v1.json")
        assertTrue(vault.isFile)
        assertFalse(vault.readText().contains("ci-only-model-key"))
        assertNull(activity().intent.data)
        assertEquals(true, js("document.documentElement.dataset.runtime === 'android'"))
        assertEquals(true, js("document.documentElement.scrollWidth <= innerWidth + 1"))
        open(link)
        waitFor("warm confirmation") { js("!!document.querySelector('.ant-modal input')") == true }
        js("document.querySelector('.ant-modal-footer .ant-btn-primary').click()")
        waitFor("duplicate confirmation closes") { js("!document.querySelector('.ant-modal input')") == true }
        val providers = "JSON.parse(JSON.parse(localStorage.getItem('persist:cherry-studio')).llm).providers"
        assertEquals(1, (js("$providers.filter(p=>p.name==='Android CI provider').length") as Number).toInt())
        open(link.replace("app=codex", "app=gemini"))
        waitFor("invalid link rejected") { js("!!document.querySelector('.ant-message-error')") == true }
        assertEquals(false, js("!!document.querySelector('.ant-modal input')"))
        // Fresh CI devices still show onboarding after a provider import.
        // Complete its real Skip action before expecting Home after restart.
        if (js("localStorage.getItem('onboarding-completed') === 'true'") != true) {
            assertEquals(true, js("!!document.querySelector('button.ant-btn-text')"))
            js("document.querySelector('button.ant-btn-text').click()")
        }
        waitFor("onboarding persisted") { js("localStorage.getItem('onboarding-completed') === 'true'") == true }
        verifyNotificationPermission()
    }

    @Test fun nativeModelAndProviderSelectorsRemainStable() {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitFor("home after selector test start") { js("!!document.querySelector('#home-page')") == true }
        waitFor("native model and provider selectors") {
            js("document.querySelectorAll('.model-provider-fields select').length") == 2
        }

        val modelSelector = "document.querySelectorAll('.model-provider-fields select')[0]"
        val providerSelector = "document.querySelectorAll('.model-provider-fields select')[1]"
        assertEquals("select", js("$modelSelector.tagName").toString().lowercase())
        assertEquals("select", js("$providerSelector.tagName").toString().lowercase())
        assertEquals(true, js("$modelSelector.options.length > 1"))
        assertEquals(true, js("$providerSelector.options.length > 1"))
        assertEquals(true, js("$modelSelector.closest('.model-provider-fields').getBoundingClientRect().width > 0"))

        // Keep a node reference while React commits the controlled selection. The native
        // control must survive the redraw instead of closing an Android system picker.
        js("window.__nativeModelSelector=$modelSelector; window.__nativeProviderSelector=$providerSelector")
        val modelChanged = js("""
            (() => {
              const select=$modelSelector;
              const next=Array.from(select.options).find(option => !option.disabled && option.value && option.value !== select.value);
              if (next) { select.value=next.value; select.dispatchEvent(new Event('change', {bubbles:true})); return true; }
              return false;
            })()
        """.trimIndent())
        if (modelChanged == true) {
            waitFor("model selection commit") { js("$modelSelector.value === window.__nativeModelSelector.value") == true }
        }
        js("""
            (() => {
              const select=$providerSelector;
              const next=Array.from(select.options).find(option => !option.disabled && option.value);
              if (next) { select.value=next.value; select.dispatchEvent(new Event('change', {bubbles:true})); }
            })()
        """.trimIndent())
        waitFor("provider selection commit") { js("$providerSelector.value === window.__nativeProviderSelector.value") == true }
        assertEquals(true, js("window.__nativeModelSelector === $modelSelector"))
        assertEquals(true, js("window.__nativeProviderSelector === $providerSelector"))
        assertEquals(true, js("document.documentElement.scrollWidth <= innerWidth + 1"))
        js("delete window.__nativeModelSelector; delete window.__nativeProviderSelector")
    }

    /** Run in a second instrumentation process after force-stopping the first. */
    @Test fun credentialsSurviveProcessRestart() {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitFor("cold restarted renderer") { js("!!document.querySelector('#home-page')") == true }
        assertEquals(false, js("JSON.stringify(localStorage).includes('ci-only-model-key')"))
        val providers = "JSON.parse(JSON.parse(localStorage.getItem('persist:cherry-studio')).llm).providers"
        assertEquals(1, (js("$providers.filter(p=>p.name==='Android CI provider').length") as Number).toInt())
        assertEquals(true, js("$providers.find(p=>p.name==='Android CI provider').apiKey.startsWith('lich13-secret:')"))
        val vault = File(context.noBackupFilesDir, "credentials-v1.json")
        assertTrue(vault.isFile)
        assertFalse(vault.readText().contains("ci-only-model-key"))
        assertNull(activity().intent.data)
    }
}
