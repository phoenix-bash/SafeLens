package com.safelens.app.service

import android.content.ComponentName
import android.content.Context
import android.app.Notification
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

import com.safelens.app.SafeLensApplication
import com.safelens.app.data.NotificationRecordDto

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.Locale
import java.util.UUID

class NotificationCaptureService : NotificationListenerService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val repository by lazy {
        (application as SafeLensApplication).container.deviceRepository
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        serviceScope.launch {
            captureNotification(notification)
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        activeInstance = this
        serviceScope.launch {
            captureActiveNotificationsSnapshot()
            repository.uploadPendingNotifications()
        }
    }

    override fun onListenerDisconnected() {
        if (activeInstance === this) {
            activeInstance = null
        }
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        if (activeInstance === this) {
            activeInstance = null
        }
        serviceScope.cancel()
        super.onDestroy()
    }

    private suspend fun captureActiveNotificationsSnapshot(): Int = withContext(Dispatchers.IO) {
        val snapshot = activeNotifications.orEmpty()
        snapshot.forEach { notification ->
            captureNotification(notification)
        }
        snapshot.size
    }

    private suspend fun captureNotification(notification: StatusBarNotification) {
        val extras = notification.notification.extras
        val title = extras?.getCharSequence("android.title")?.toString()?.trim().orEmpty()
        val text = extras?.getCharSequence("android.text")?.toString()?.trim().orEmpty()
        if (title.isBlank() && text.isBlank()) {
            return
        }

        val appLabel = resolveAppLabel(notification.packageName)
        if (!shouldCapture(notification, appLabel, title, text)) {
            return
        }

        val normalizedTitle = title.ifBlank { "(no title)" }
        val normalizedText = text.ifBlank { "(no text)" }
        val fingerprintSource = listOf(
            appLabel.normalizeFingerprintPart(),
            normalizedTitle.normalizeFingerprintPart(),
            normalizedText.normalizeFingerprintPart()
        ).joinToString("|")

        repository.queueNotificationRecord(
            NotificationRecordDto(
                clientId = UUID.randomUUID().toString(),
                fingerprint = fingerprintSource.hashFingerprint(),
                packageName = notification.packageName,
                appLabel = appLabel,
                title = normalizedTitle,
                text = normalizedText,
                postedAt = Instant.ofEpochMilli(notification.postTime).toString()
            )
        )
    }

    private fun shouldCapture(
        notification: StatusBarNotification,
        appLabel: String,
        title: String,
        text: String
    ): Boolean {
        if (notification.packageName == packageName) {
            return false
        }

        if (notification.packageName == "android" || notification.packageName == "com.android.systemui") {
            return false
        }

        val flags = notification.notification.flags
        if ((flags and android.app.Notification.FLAG_ONGOING_EVENT) != 0) {
            return false
        }

        if ((flags and Notification.FLAG_GROUP_SUMMARY) != 0) {
            return false
        }

        if (isUnhelpfulSummaryNotification(appLabel, title, text)) {
            return false
        }

        return notification.isClearable || notification.notification.tickerText != null
    }

    private fun resolveAppLabel(packageName: String): String {
        val resolvedLabel = runCatching {
            packageManager.getApplicationLabel(
                packageManager.getApplicationInfo(packageName, 0)
            ).toString()
        }.getOrNull()?.trim().orEmpty()

        return if (resolvedLabel.isNotBlank() && !resolvedLabel.looksLikePackageName()) {
            resolvedLabel
        } else {
            packageName.humanizePackageName()
        }
    }

    private fun isUnhelpfulSummaryNotification(
        appLabel: String,
        title: String,
        text: String
    ): Boolean {
        val normalizedTitle = title.normalizeDisplayText()
        val normalizedText = text.normalizeDisplayText()
        val normalizedAppLabel = appLabel.normalizeDisplayText()
        val chatSummaryPattern = Regex("^\\d+\\s+messages?\\s+from\\s+\\d+\\s+chats?$")

        return normalizedTitle == normalizedAppLabel && chatSummaryPattern.matches(normalizedText)
    }

    private fun String.hashFingerprint(): String {
        return java.security.MessageDigest.getInstance("SHA-256")
            .digest(toByteArray())
            .joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun String.normalizeFingerprintPart(): String {
        return normalizeDisplayText()
            .replace(Regex("\\(\\d+\\s+messages?\\)\\s*:"), ":")
            .replace(Regex("\\s+"), " ")
            .lowercase(Locale.US)
    }

    private fun String.normalizeDisplayText(): String {
        return replace(Regex("\\s+"), " ").trim()
    }

    private fun String.looksLikePackageName(): Boolean {
        return Regex("^[a-z0-9_]+(\\.[a-z0-9_]+)+$", RegexOption.IGNORE_CASE).matches(trim())
    }

    private fun String.humanizePackageName(): String {
        val normalizedPackage = trim().lowercase(Locale.US)
        val knownNames = mapOf(
            "com.whatsapp" to "WhatsApp",
            "com.android.soundrecorder" to "Sound Recorder",
            "com.google.android.gm" to "Gmail",
            "com.instagram.android" to "Instagram",
            "com.facebook.katana" to "Facebook",
            "com.facebook.orca" to "Messenger",
            "org.telegram.messenger" to "Telegram",
            "com.google.android.youtube" to "YouTube"
        )
        knownNames[normalizedPackage]?.let { return it }

        val genericSegments = setOf("com", "org", "net", "android", "google", "app", "apps", "mobile")
        val candidate = normalizedPackage
            .split(".")
            .asReversed()
            .firstOrNull { segment -> segment.isNotBlank() && segment !in genericSegments }
            ?: normalizedPackage.substringAfterLast('.')

        return candidate
            .replace("whatsapp", "whats app")
            .replace("soundrecorder", "sound recorder")
            .replace("voice recorder", "voice recorder")
            .replace('_', ' ')
            .replace('-', ' ')
            .replace(Regex("([a-z])([A-Z])"), "$1 $2")
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .joinToString(" ") { part ->
                part.replaceFirstChar { char -> char.uppercase(Locale.US) }
            }
    }

    companion object {
        @Volatile
        private var activeInstance: NotificationCaptureService? = null

        fun isListenerConnected(): Boolean = activeInstance != null

        fun ensureListenerBound(context: Context) {
            requestRebind(ComponentName(context, NotificationCaptureService::class.java))
        }

        suspend fun captureActiveNotificationsSnapshot(
            service: DeviceConnectionService
        ): Int {
            activeInstance?.let { listener ->
                return listener.captureActiveNotificationsSnapshot()
            }

            ensureListenerBound(service)
            repeat(10) {
                delay(300)
                activeInstance?.let { listener ->
                    return listener.captureActiveNotificationsSnapshot()
                }
            }

            error(buildUnavailableMessage())
        }

        private fun buildUnavailableMessage(): String {
            val manufacturer = Build.MANUFACTURER.orEmpty().lowercase(Locale.US)
            val brand = Build.BRAND.orEmpty().lowercase(Locale.US)
            val isMiuiFamily =
                manufacturer.contains("xiaomi") ||
                    brand.contains("xiaomi") ||
                    brand.contains("redmi") ||
                    brand.contains("poco")

            return if (isMiuiFamily) {
                "Notification listener is enabled but MIUI is blocking SafeLens from starting it. Enable Auto start for SafeLens in MIUI settings, reopen the app, then try refresh again."
            } else {
                "Notification listener unavailable. Reopen notification access if this persists."
            }
        }
    }
}
