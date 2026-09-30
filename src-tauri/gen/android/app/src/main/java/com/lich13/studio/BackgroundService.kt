package com.lich13.studio

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class BackgroundService : Service() {
    companion object {
        val tasks = ConcurrentHashMap.newKeySet<String>()
        var stoppedReason: String? = null
        private const val CHANNEL = "active-model-requests"
        private const val ID = 128
        @JvmStatic external fun cancelNativeTasks()
        fun stopAll(context: Context, reason: String) {
            stoppedReason = reason
            tasks.clear()
            cancelNativeTasks()
            MainActivity.web.get()?.post {
                MainActivity.web.get()?.evaluateJavascript("window.dispatchEvent(new CustomEvent('mobile-tasks-stopped',{detail:${JSONObject.quote(reason)}}))", null)
            }
            context.stopService(Intent(context, BackgroundService::class.java))
        }
        fun begin(context: Context, id: String) {
            stoppedReason = null
            tasks.add(id)
            try { context.startForegroundService(Intent(context, BackgroundService::class.java)) }
            catch (error: Exception) { tasks.remove(id); throw error }
        }
        fun end(context: Context, id: String) {
            tasks.remove(id)
            if (tasks.isEmpty()) context.stopService(Intent(context, BackgroundService::class.java))
        }
    }
    private var wakeLock: PowerManager.WakeLock? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { stopAll(this, "user-stop"); return START_NOT_STICKY }
        if (tasks.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.model_tasks), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, BackgroundService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("lich13studio").setContentText(getString(R.string.model_tasks_running))
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, getString(R.string.stop_all), stop).build()).build()
        startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (wakeLock == null) {
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lich13studio:model-tasks").apply { setReferenceCounted(false); acquire() }
        }
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) { stopAll(this, "system-budget"); stopSelf(startId) }
    override fun onTaskRemoved(rootIntent: Intent?) { stopAll(this, "app-exit"); super.onTaskRemoved(rootIntent) }
    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        if (tasks.isNotEmpty()) stopAll(this, "service-stopped")
        super.onDestroy()
    }
}
