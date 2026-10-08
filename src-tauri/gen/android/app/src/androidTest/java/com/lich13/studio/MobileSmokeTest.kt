package com.lich13.studio

import android.content.Intent
import android.app.ActivityManager
import android.content.Context
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
    private fun installLoopbackOnlyFetch() {
        js("""
            (() => {
              const original = window.fetch.bind(window);
              window.__modelTraceBlockedExternalFetches = 0;
              window.fetch = (input, init) => {
                const raw = typeof input === 'string' ? input : input.url;
                const url = new URL(raw, location.href);
                if (['http:', 'https:'].includes(url.protocol) &&
                    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
                  window.__modelTraceBlockedExternalFetches += 1;
                  return Promise.reject(new TypeError('Instrumentation only permits loopback HTTP'));
                }
                return original(input, init);
              };
            })()
        """.trimIndent())
    }
    private fun chooseModelTraceTarget(providerName: String) {
        val modelChanged = js("""
            (() => {
              const selects = document.querySelectorAll('.model-provider-fields select');
              if (selects.length !== 2) return false;
              const option = Array.from(selects[0].options).find((item) => {
                try {
                  const value = JSON.parse(item.value);
                  return value[0] === 'openai' && value[1] === 'gpt-5.4' && !item.disabled;
                } catch { return false; }
              });
              if (!option) return false;
              selects[0].value = option.value;
              selects[0].dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()
        """.trimIndent())
        assertEquals(true, modelChanged)
        val modelValue = org.json.JSONObject.quote("[\"openai\",\"gpt-5.4\"]")
        waitFor("ModelTrace model selection committed") {
            js("document.querySelectorAll('.model-provider-fields select')[0].value === " + modelValue) == true
        }
        val providerNameLiteral = org.json.JSONObject.quote(providerName)
        val providerChanged = js("""
            (() => {
              const selects = document.querySelectorAll('.model-provider-fields select');
              const option = Array.from(selects[1].options).find((item) =>
                item.textContent.trim() ===
        """.trimIndent() + providerNameLiteral + """
                && !item.disabled);
              if (!option) return false;
              selects[1].value = option.value;
              selects[1].dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()
        """.trimIndent())
        assertEquals(true, providerChanged)
        waitFor("ModelTrace provider selection committed") {
            js("document.querySelectorAll('.model-provider-fields select')[1].selectedOptions[0].textContent.trim() === " + providerNameLiteral) == true
        }
        assertEquals(false, js("document.querySelector('.ant-btn-primary')?.disabled"))
    }
    private fun assertEarlyModelTraceResult(sample: String) {
        val ui = js("""
            (() => {
              const body = document.body.innerText;
              const cards = Array.from(document.querySelectorAll('.ant-card-small'));
              const prediction = Array.from(document.querySelectorAll('.ant-typography strong'))
                .map((item) => item.textContent.trim())
                .find((text) => text.startsWith('gpt-5.4 ·'));
              return {
                early: Array.from(document.querySelectorAll('.ant-tag')).some((tag) =>
                  ['已提前完成', 'Completed early'].includes(tag.textContent.trim())),
                usedOne: body.includes('参与分析：1 组') || body.includes('Groups analyzed: 1'),
                probability: prediction
                  ? Number(prediction.split('·').pop().trim().replace('%', ''))
                  : 0,
                statuses: cards.map((card) => card.querySelector('.ant-tag')?.textContent.trim() || ''),
                outputs: cards.map((card) => card.querySelector('textarea')?.value || '')
              };
            })()
        """.trimIndent()) as org.json.JSONObject
        assertTrue("confidence result is visible", ui.optBoolean("early"))
        assertTrue("only one output contributed", ui.optBoolean("usedOne"))
        assertTrue("displayed confidence is at least 99%", ui.optDouble("probability") >= 99.0)
        val statuses = checkNotNull(ui.optJSONArray("statuses"))
        assertEquals(3, statuses.length())
        assertTrue(statuses.optString(0) in setOf("已完成", "Completed"))
        assertTrue(statuses.optString(1) in setOf("无需继续", "無需繼續", "Not needed"))
        assertTrue(statuses.optString(2) in setOf("无需继续", "無需繼續", "Not needed"))
        val outputs = checkNotNull(ui.optJSONArray("outputs"))
        assertEquals(sample.trim(), outputs.optString(0))
        assertEquals("", outputs.optString(1))
        assertEquals("", outputs.optString(2))
    }
    private fun readNativeTaskState(): org.json.JSONObject {
        js("""
            window.__modelTraceTaskStateDone = false;
            window.__modelTraceTaskState = null;
            void window.__TAURI_INTERNALS__.invoke('mobile_command', {
              command: 'taskState', args: {}
            }).then((state) => {
              window.__modelTraceTaskState = state;
              window.__modelTraceTaskStateDone = true;
            }, () => { window.__modelTraceTaskStateDone = true; });
        """.trimIndent())
        waitFor("native taskState reply") { js("window.__modelTraceTaskStateDone === true") == true }
        val state = js("window.__modelTraceTaskState") as? org.json.JSONObject
        js("delete window.__modelTraceTaskState; delete window.__modelTraceTaskStateDone")
        return checkNotNull(state) { "mobile_command taskState did not return an object" }
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

    @Test fun modelTraceEarlyFinishStopsAtOneResponseAndReleasesAndroidTask() {
        val server = LoopbackModelTraceServer("modeltrace-fixture-key")
        val providerName = "Android ModelTrace fixture " + server.port
        try {
            val link = Uri.Builder().scheme("ccswitch").authority("v1").appendPath("import")
                .appendQueryParameter("resource", "provider").appendQueryParameter("app", "codex")
                .appendQueryParameter("name", providerName)
                .appendQueryParameter("endpoint", "http://127.0.0.1:" + server.port + "/v1")
                .appendQueryParameter("apiKey", "modeltrace-fixture-key")
                .appendQueryParameter("model", "gpt-5.4").build().toString()
            open(link)
            waitFor("loopback provider import confirmation") { js("!!document.querySelector('.ant-modal input')") == true }
            assertEquals(providerName, js("document.querySelector('.ant-modal input').value"))
            assertEquals(false, js("document.body.innerText.includes('modeltrace-fixture-key')"))
            js("document.querySelector('.ant-modal-footer .ant-btn-primary').click()")
            val providers = "JSON.parse(JSON.parse(localStorage.getItem('persist:cherry-studio')).llm).providers"
            val providerNameLiteral = org.json.JSONObject.quote(providerName)
            waitFor("loopback provider persisted") {
                js(providers + ".some(p=>p.name===" + providerNameLiteral + ")") == true
            }
            assertEquals(false, js("JSON.stringify(localStorage).includes('modeltrace-fixture-key')"))
            if (js("localStorage.getItem('onboarding-completed') === 'true'") != true) {
                waitFor("onboarding skip button") { js("!!document.querySelector('button.ant-btn-text')") == true }
                js("document.querySelector('button.ant-btn-text').click()")
            }
            waitFor("onboarding persisted") { js("localStorage.getItem('onboarding-completed') === 'true'") == true }
            verifyNotificationPermission()
            installLoopbackOnlyFetch()

            js("document.querySelector('nav.mobile-navigation button:nth-child(2)').click()")
            waitFor("ModelTrace test page") {
                js("location.hash.endsWith('/model-test') && document.querySelectorAll('.ant-card-small').length === 3 && document.querySelectorAll('.model-provider-fields select').length === 2") == true
            }
            chooseModelTraceTarget(providerName)
            assertEquals(true, js("document.querySelector('.ant-btn-primary').click(); true"))
            waitFor("single loopback Responses request") { server.postCount == 1 || server.failure != null }
            assertNull("loopback server failed", server.failure)
            assertEquals(1, server.postCount)
            assertEquals("/v1/responses", server.lastPath)
            assertEquals("gpt-5.4", server.requestedModel)
            assertTrue("fixture authorization reached the local provider", server.authorizationMatches)

            waitFor("early result and native task release") {
                js("document.body.innerText.includes('已提前完成') || document.body.innerText.includes('Completed early')") == true &&
                    BackgroundService.tasks.isEmpty()
            }
            Thread.sleep(250)
            assertEquals(1, server.postCount)
            assertNull("no active native ModelTrace task", BackgroundService.tasks.firstOrNull())
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            waitFor("Android foreground service stopped") {
                activityManager.getRunningServices(Int.MAX_VALUE).none {
                    it.service.className == BackgroundService::class.java.name
                }
            }
            val nativeState = readNativeTaskState()
            assertTrue("taskState has no stop reason after release", nativeState.isNull("stoppedReason"))
            assertEarlyModelTraceResult(LoopbackModelTraceServer.SAMPLE)

            js("document.querySelector('nav.mobile-navigation button:first-child').click()")
            waitFor("left ModelTrace page") { js("!!document.querySelector('#home-page')") == true }
            js("document.querySelector('nav.mobile-navigation button:nth-child(2)').click()")
            waitFor("returned to ModelTrace page with result") {
                js("location.hash.endsWith('/model-test') && (document.body.innerText.includes('已提前完成') || document.body.innerText.includes('Completed early'))") == true
            }
            assertEarlyModelTraceResult(LoopbackModelTraceServer.SAMPLE)
            assertEquals(1, server.postCount)
        } finally {
            server.close()
        }
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
