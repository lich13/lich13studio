package com.lich13.studio

import android.app.Activity
import android.app.NotificationManager
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.annotation.*
import app.tauri.plugin.*
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

@InvokeArg
class MobileArgs { var id: String = ""; var value: String = ""; var path: String = ""; var name: String = ""; var url: String = ""; var request: Boolean = false }

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "taskNotifications")])
class MobileRuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "lich13studio.credentials.v1"
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val notificationRequests = mutableListOf<Invoke>()
    private fun notificationsGranted() = activity.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
    @Command fun notificationPermission(invoke: Invoke) {
        val request = invoke.parseArgs(MobileArgs::class.java).request
        activity.runOnUiThread {
            // Always resolve already-granted requests, including concurrent callers.
            if (!request || Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                invoke.resolve(JSObject().put("granted", notificationsGranted()))
            } else {
                notificationRequests.add(invoke)
                if (notificationRequests.size == 1) {
                    try { requestPermissionForAlias("taskNotifications", invoke, "notificationPermissionResult") }
                    catch (_: Exception) { finishNotificationRequests() }
                }
            }
        }
    }
    @PermissionCallback fun notificationPermissionResult(invoke: Invoke) { finishNotificationRequests() }
    private fun finishNotificationRequests() {
        val pending = notificationRequests.toList()
        notificationRequests.clear()
        val result = JSObject().put("granted", notificationsGranted())
        pending.forEach { it.resolve(result) }
    }
    private fun file() = AtomicFile(File(activity.noBackupFilesDir, "credentials-v1.json"))
    private fun secret(create: Boolean): SecretKey {
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    @Command fun readCredentials(invoke: Invoke) {
        try {
            val file = file()
            if (!file.baseFile.exists()) { invoke.resolve(JSObject().put("value", "{}")); return }
            val saved = JSONObject(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secret(false), GCMParameterSpec(128, Base64.decode(saved.getString("iv"), Base64.NO_WRAP)))
            cipher.updateAAD(alias.toByteArray())
            val value = cipher.doFinal(Base64.decode(saved.getString("ciphertext"), Base64.NO_WRAP)).toString(Charsets.UTF_8)
            invoke.resolve(JSObject().put("value", value))
        } catch (_: Exception) { invoke.reject("安全存储读取失败") }
    }
    @Command fun writeCredentials(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(MobileArgs::class.java)
            require(args.value.length <= 4 * 1024 * 1024)
            JSONObject(args.value)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secret(true)); cipher.updateAAD(alias.toByteArray())
            val saved = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(cipher.doFinal(args.value.toByteArray()), Base64.NO_WRAP))
            val file = file(); val stream = file.startWrite()
            try { stream.write(saved.toString().toByteArray()); file.finishWrite(stream) }
            catch (error: Exception) { file.failWrite(stream); throw error }
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("安全存储写入失败") }
    }
    @Command fun clearCredentials(invoke: Invoke) {
        try { file().delete(); store.deleteEntry(alias); invoke.resolve() }
        catch (_: Exception) { invoke.reject("安全存储删除失败") }
    }
    @Command fun beginTask(invoke: Invoke) {
        try { BackgroundService.begin(activity, invoke.parseArgs(MobileArgs::class.java).id); invoke.resolve() }
        catch (_: Exception) { invoke.reject("无法启动后台任务") }
    }
    @Command fun endTask(invoke: Invoke) { BackgroundService.end(activity, invoke.parseArgs(MobileArgs::class.java).id); invoke.resolve() }
    @Command fun stopTasks(invoke: Invoke) { BackgroundService.stopAll(activity, "user-stop"); invoke.resolve() }
    @Command fun consumeImportIntent(invoke: Invoke) { activity.runOnUiThread { activity.intent?.data = null; invoke.resolve() } }
    @Command fun taskState(invoke: Invoke) { invoke.resolve(JSObject().put("stoppedReason", BackgroundService.stoppedReason)) }
    @Command fun background(invoke: Invoke) { activity.runOnUiThread { activity.moveTaskToBack(true); invoke.resolve() } }
    @Command fun openUrl(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.parseArgs(MobileArgs::class.java).url)
            require(uri.scheme in listOf("https", "http", "mailto", "tel"))
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri)); invoke.resolve()
        } catch (_: Exception) { invoke.reject("无法打开链接") }
    }
    @Command fun saveFile(invoke: Invoke) {
        val args = invoke.parseArgs(MobileArgs::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, args.name)
        startActivityForResult(invoke, intent, "savedFile")
    }
    @ActivityCallback fun savedFile(invoke: Invoke, result: ActivityResult) {
        try {
            val uri = result.data?.data
            if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("uri", "")); return }
            val source = File(invoke.parseArgs(MobileArgs::class.java).path)
            require(source.canonicalPath.startsWith(activity.filesDir.parentFile!!.canonicalPath + "/"))
            activity.contentResolver.openOutputStream(uri, "wt")!!.use { output -> source.inputStream().use { it.copyTo(output) } }
            invoke.resolve(JSObject().put("uri", uri.toString()))
        } catch (_: Exception) { invoke.reject("文件导出失败") }
    }
}
