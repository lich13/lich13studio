package com.lich13.studio

import android.content.Intent
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
        // Report only readiness flags and fixture comparisons, never saved values.
        val state = js("""
            (() => {
              let provider;
              try {
                const state = JSON.parse(localStorage.getItem('persist:cherry-studio'));
                provider = JSON.parse(state.llm).providers.find(p => p.name === 'Android CI provider');
              } catch {}
              const input = document.querySelector('input[name=apiHost]');
              const expected = 'http://127.0.0.1:18765/v1';
              return JSON.stringify({
                ready: document.readyState,
                rootChildren: document.getElementById('root')?.childElementCount,
                startupLogo: !!document.querySelector('#root img[alt=lich13studio]'),
                startupError: !!document.querySelector('#root > main > button'),
                onboarding: !!document.querySelector('button.ant-btn-text'),
                home: !!document.querySelector('#home-page'),
                focused: document.activeElement?.tagName,
                providerSaved: !!provider,
                addressSaved: provider?.apiHost === expected,
                addressInput: !!input,
                addressNormalized: input?.value === expected,
                addressMatchesSaved: !!provider && input?.value === provider.apiHost
              });
            })()
        """.trimIndent())
        fail("Timed out: $label; renderer=$state")
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
    private fun fillInput(name: String, value: String) {
        val selector = org.json.JSONObject.quote("input[name='$name']")
        val literal = org.json.JSONObject.quote(value)
        assertEquals(true, js("""
            (() => {
              const input = document.querySelector($selector);
              if (!input) return false;
              input.focus();
              input.addEventListener('focusout', () => input.dataset.blurred = 'true', { once: true });
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, $literal);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              // The value property changes before React commits the controlled input.
              // Mark a later frame so blur cannot use the previous render's handler.
              requestAnimationFrame(() => requestAnimationFrame(() => input.dataset.committed = 'true'));
              return true;
            })()
        """.trimIndent()))
        waitFor("input value committed") { js("document.querySelector($selector)?.value === $literal && document.querySelector($selector)?.dataset.committed === 'true'") == true }
        js("document.querySelector($selector).blur()")
        waitFor("input blur delivered") { js("document.querySelector($selector)?.dataset.blurred === 'true'") == true }
    }

    @Test fun providerSettingsKeepCredentialsPrivate() {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitFor("renderer ready") { js("!!document.querySelector('button.ant-btn-text') || !!document.querySelector('#home-page')") == true }
        if (js("localStorage.getItem('onboarding-completed') === 'true'") != true) {
            js("document.querySelector('button.ant-btn-text').click()")
        }
        waitFor("home after onboarding") { js("!!document.querySelector('#home-page')") == true }
        js("document.querySelector('nav.mobile-navigation button:last-child').click()")
        waitFor("provider settings") { js("location.hash.endsWith('/settings/provider')") == true }
        waitFor("add provider button") {
            js("Array.from(document.querySelectorAll('#content-container button')).some(button => button.querySelector('svg.lucide-plus'))") == true
        }
        js("Array.from(document.querySelectorAll('#content-container button')).find(button => button.querySelector('svg.lucide-plus')).click()")
        waitFor("provider name dialog") { js("!!document.querySelector('input[name=providerName]')") == true }
        fillInput("providerName", "Android CI provider")
        js("document.querySelector('.ant-modal-footer .ant-btn-primary').click()")
        waitFor("provider settings form") { js("!!document.querySelector('input[name=apiHost]') && !document.querySelector('input[name=providerName]')") == true }
        fillInput("apiHost", "http://127.0.0.1:18765//v1/v1")
        val providers = "JSON.parse(JSON.parse(localStorage.getItem('persist:cherry-studio')).llm).providers"
        waitFor("normalized address persisted") {
            js("$providers.some(p=>p.name==='Android CI provider' && p.apiHost==='http://127.0.0.1:18765/v1')") == true
        }
        fillInput("apiKey", "ci-only-model-key")
        waitFor("protected persistence") {
            js("$providers.some(p=>p.name==='Android CI provider' && p.apiKey.startsWith('lich13-secret:'))") == true
        }
        assertEquals(false, js("document.body.innerText.includes('ci-only-model-key')"))
        assertEquals(false, js("JSON.stringify(localStorage).includes('ci-only-model-key')"))
        val vault = File(context.noBackupFilesDir, "credentials-v1.json")
        assertTrue(vault.isFile)
        assertFalse(vault.readText().contains("ci-only-model-key"))
        assertEquals(true, js("document.documentElement.dataset.runtime === 'android'"))
        assertEquals(true, js("document.documentElement.scrollWidth <= innerWidth + 1"))
        js("document.querySelector('nav.mobile-navigation button:first-child').click()")
        waitFor("return to home") { js("!!document.querySelector('#home-page')") == true }
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
