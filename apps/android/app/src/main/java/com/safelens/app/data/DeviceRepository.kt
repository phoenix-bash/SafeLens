package com.safelens.app.data

import android.Manifest
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.BatteryManager
import android.provider.CallLog
import android.provider.Settings
import androidx.core.content.ContextCompat

import com.safelens.app.BuildConfig
import com.safelens.app.device.CapabilityRegistry
import com.safelens.app.device.DeviceMetadataCollector
import com.safelens.app.service.NotificationCaptureService
import com.safelens.app.sync.DeviceSyncStore

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.Locale
import java.util.UUID

class DeviceRepository(
    private val application: Application,
    private val apiClient: ApiClient,
    private val sessionStore: SecureSessionStore,
    private val metadataCollector: DeviceMetadataCollector,
    private val capabilityRegistry: CapabilityRegistry,
    private val syncStore: DeviceSyncStore
) {
    fun getApiBaseUrl(): String = sessionStore.readApiBaseUrl(BuildConfig.API_BASE_URL)

    fun saveApiBaseUrl(value: String): String {
        val normalizedValue = normalizeApiBaseUrl(value)
        sessionStore.saveApiBaseUrl(normalizedValue)
        return normalizedValue
    }

    suspend fun testConnectivity(): HealthStatusDto = withContext(Dispatchers.IO) {
        apiClient.healthCheck(getApiBaseUrl())
    }

    suspend fun pair(code: String): StoredDeviceSession = withContext(Dispatchers.IO) {
        val metadata = metadataCollector.collect()
        val response = apiClient.pairDevice(
            getApiBaseUrl(),
            PairDeviceRequestDto(
                code = code.trim().uppercase(),
                deviceName = metadata.deviceName,
                model = metadata.model,
                manufacturer = metadata.manufacturer,
                androidVersion = metadata.androidVersion,
                deviceFingerprint = metadata.deviceFingerprint,
                capabilities = capabilityRegistry.capabilities()
            )
        )

        val session = StoredDeviceSession(
            deviceId = response.deviceId,
            deviceToken = response.deviceToken,
            workspaceId = response.workspaceId,
            pairedAt = response.pairedAt
        )
        sessionStore.save(session)
        session
    }

    fun getStoredSession(): StoredDeviceSession? = sessionStore.read()

    fun activateStoredSessionIfPresent(): StoredDeviceSession? {
        return sessionStore.read()
    }

    suspend fun syncStoredSession(): StoredDeviceSession? = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext null

        runCatching {
            apiClient.getDeviceSessionStatus(getApiBaseUrl(), storedSession.deviceToken)
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
        }.getOrNull() ?: return@withContext null

        storedSession
    }

    suspend fun heartbeatStoredSession(): StoredDeviceSession? = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext null

        runCatching {
            apiClient.heartbeatSelf(getApiBaseUrl(), storedSession.deviceToken)
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
                return@withContext null
            }
            return@withContext storedSession
        }.getOrNull() ?: return@withContext null

        storedSession
    }

    suspend fun uploadPendingTelemetry(throwOnFailure: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext false
        val pendingSnapshots = syncStore.getPendingTelemetry(limit = 25)
        if (pendingSnapshots.isEmpty()) {
            return@withContext false
        }

        runCatching {
            apiClient.uploadTelemetryBatch(
                getApiBaseUrl(),
                storedSession.deviceToken,
                TelemetryBatchIngestRequestDto(pendingSnapshots)
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            if (throwOnFailure) {
                throw IllegalStateException(
                    throwable.message ?: "Telemetry upload failed."
                )
            }
        }.getOrElse {
            return@withContext false
        }

        syncStore.markTelemetrySynced(
            pendingSnapshots.map { it.clientId },
            Instant.now().toString()
        )
        true
    }

    suspend fun uploadPendingNotifications(throwOnFailure: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext false
        val pendingNotifications = syncStore.getPendingNotifications(limit = 25)
        if (pendingNotifications.isEmpty()) {
            return@withContext false
        }

        runCatching {
            apiClient.uploadNotificationBatch(
                getApiBaseUrl(),
                storedSession.deviceToken,
                NotificationBatchIngestRequestDto(pendingNotifications)
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            if (throwOnFailure) {
                throw IllegalStateException(
                    throwable.message ?: "Notification upload failed."
                )
            }
        }.getOrElse {
            return@withContext false
        }

        syncStore.markNotificationsSynced(
            pendingNotifications.map { it.clientId },
            Instant.now().toString()
        )
        true
    }

    suspend fun uploadPendingCallLogs(throwOnFailure: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext false
        val pendingCallLogs = syncStore.getPendingCallLogs(limit = 50)
        if (pendingCallLogs.isEmpty()) {
            return@withContext false
        }

        runCatching {
            apiClient.uploadCallLogBatch(
                getApiBaseUrl(),
                storedSession.deviceToken,
                CallLogBatchIngestRequestDto(pendingCallLogs)
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            if (throwOnFailure) {
                throw IllegalStateException(
                    throwable.message ?: "Call log upload failed."
                )
            }
        }.getOrElse {
            return@withContext false
        }

        syncStore.markCallLogsSynced(
            pendingCallLogs.map { it.clientId },
            Instant.now().toString()
        )
        true
    }

    suspend fun uploadCameraStreamFrame(payload: CameraStreamFrameUploadDto) = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: error("Device session unavailable.")

        runCatching {
            apiClient.uploadCameraStreamFrame(
                getApiBaseUrl(),
                storedSession.deviceToken,
                payload
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            throw IllegalStateException(
                throwable.message ?: "Camera stream frame upload failed."
            )
        }
    }

    suspend fun uploadCameraStreamAudioChunk(payload: CameraStreamAudioChunkUploadDto) = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: error("Device session unavailable.")

        runCatching {
            apiClient.uploadCameraStreamAudioChunk(
                getApiBaseUrl(),
                storedSession.deviceToken,
                payload
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            throw IllegalStateException(
                throwable.message ?: "Camera stream audio upload failed."
            )
        }
    }

    suspend fun updateCameraStreamState(payload: CameraStreamDeviceStateUpdateDto) = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: error("Device session unavailable.")

        runCatching {
            apiClient.updateCameraStreamState(
                getApiBaseUrl(),
                storedSession.deviceToken,
                payload
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
            throw IllegalStateException(
                throwable.message ?: "Camera stream state update failed."
            )
        }
    }

    suspend fun getSelfCameraStreamSession(): CameraStreamSessionStateDto = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: error("Device session unavailable.")

        runCatching {
            apiClient.getSelfCameraStreamSession(
                getApiBaseUrl(),
                storedSession.deviceToken
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
        }.getOrElse { throwable ->
            throw IllegalStateException(
                throwable.message ?: "Camera stream session fetch failed."
            )
        }
    }

    suspend fun queueDetailedDeviceInfoSnapshot() = withContext(Dispatchers.IO) {
        val info = metadataCollector.collectDetailedInfo()
        syncStore.enqueueTelemetry(
            TelemetrySnapshotDto(
                clientId = UUID.randomUUID().toString(),
                kind = "device_info",
                collectedAt = Instant.now().toString(),
                payload = TelemetrySnapshotPayloadDto(
                    deviceInfo = DeviceInfoSnapshotDto(
                        deviceName = info.deviceName,
                        model = info.model,
                        manufacturer = info.manufacturer,
                        androidVersion = info.androidVersion,
                        buildId = info.buildId,
                        fingerprint = info.fingerprint,
                        totalRamBytes = info.totalRamBytes,
                        availableStorageBytes = info.availableStorageBytes,
                        totalStorageBytes = info.totalStorageBytes,
                        sensors = info.sensors,
                        batteryOptimizationIgnored = info.batteryOptimizationIgnored
                    )
                )
            )
        )
    }

    suspend fun queueCurrentBatterySnapshot() = withContext(Dispatchers.IO) {
        val batteryIntent = application.registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        )
        val batteryManager =
            application.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val capacityPercent = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            ?.takeIf { it in 0..100 }
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = (batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100)
            .coerceAtLeast(1)
        val levelPercent =
            capacityPercent ?: if (level >= 0) (level * 100) / scale else return@withContext
        val status = batteryIntent?.getIntExtra(
            BatteryManager.EXTRA_STATUS,
            BatteryManager.BATTERY_STATUS_UNKNOWN
        ) ?: BatteryManager.BATTERY_STATUS_UNKNOWN
        val plugged = batteryIntent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val isCharging =
            when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING,
                BatteryManager.BATTERY_STATUS_FULL -> true
                BatteryManager.BATTERY_STATUS_DISCHARGING,
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
                else -> plugged != 0
            }
        val statusLabel =
            when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
                BatteryManager.BATTERY_STATUS_FULL -> "full"
                BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
                else -> "unknown"
            }

        syncStore.enqueueTelemetry(
            TelemetrySnapshotDto(
                clientId = UUID.randomUUID().toString(),
                kind = "battery",
                collectedAt = Instant.now().toString(),
                payload = TelemetrySnapshotPayloadDto(
                    battery = BatterySnapshotDto(
                        levelPercent = levelPercent,
                        isCharging = isCharging,
                        statusLabel = statusLabel
                    )
                )
            )
        )
    }

    suspend fun queueLocationSnapshot(
        latitude: Double? = null,
        longitude: Double? = null,
        accuracyMeters: Float?,
        provider: String,
        isEnabled: Boolean? = null,
        statusLabel: String? = null
    ) = withContext(Dispatchers.IO) {
        syncStore.enqueueTelemetry(
            TelemetrySnapshotDto(
                clientId = UUID.randomUUID().toString(),
                kind = "location",
                collectedAt = Instant.now().toString(),
                payload = TelemetrySnapshotPayloadDto(
                    location = LocationSnapshotDto(
                        latitude = latitude,
                        longitude = longitude,
                        accuracyMeters = accuracyMeters,
                        provider = provider,
                        isEnabled = isEnabled,
                        statusLabel = statusLabel
                    )
                )
            ),
            bypassDedup = true
        )
    }

    suspend fun queueNotificationRecord(record: NotificationRecordDto) = withContext(Dispatchers.IO) {
        syncStore.enqueueNotification(record)
    }

    suspend fun refreshCallLogsSnapshot(limit: Int = 100): Int = withContext(Dispatchers.IO) {
        if (!hasCallLogPermission()) {
            return@withContext 0
        }

        val projection = arrayOf(
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DURATION,
            CallLog.Calls.DATE
        )
        val cursor =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val queryArgs = Bundle().apply {
                    putStringArray(
                        android.content.ContentResolver.QUERY_ARG_SORT_COLUMNS,
                        arrayOf(CallLog.Calls.DATE)
                    )
                    putInt(
                        android.content.ContentResolver.QUERY_ARG_SORT_DIRECTION,
                        android.content.ContentResolver.QUERY_SORT_DIRECTION_DESCENDING
                    )
                    putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, limit)
                }
                application.contentResolver.query(
                    CallLog.Calls.CONTENT_URI,
                    projection,
                    queryArgs,
                    null
                )
            } else {
                application.contentResolver.query(
                    CallLog.Calls.CONTENT_URI,
                    projection,
                    null,
                    null,
                    "${CallLog.Calls.DATE} DESC"
                )
            } ?: return@withContext 0

        var count = 0
        cursor.use { callCursor ->
            val nameIndex = callCursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
            val numberIndex = callCursor.getColumnIndex(CallLog.Calls.NUMBER)
            val typeIndex = callCursor.getColumnIndex(CallLog.Calls.TYPE)
            val durationIndex = callCursor.getColumnIndex(CallLog.Calls.DURATION)
            val dateIndex = callCursor.getColumnIndex(CallLog.Calls.DATE)

            while (count < limit && callCursor.moveToNext()) {
                val contactName =
                    callCursor.getString(nameIndex)?.trim()?.takeIf { it.isNotBlank() }
                val phoneNumber =
                    callCursor.getString(numberIndex)?.trim()?.takeIf { it.isNotBlank() }
                        ?: "Unknown number"
                val callType = mapCallType(callCursor.getInt(typeIndex))
                val durationSeconds = callCursor.getLong(durationIndex).toInt().coerceAtLeast(0)
                val occurredAt = Instant.ofEpochMilli(callCursor.getLong(dateIndex)).toString()
                val fingerprintSource = listOf(
                    contactName?.lowercase(Locale.US).orEmpty(),
                    phoneNumber.lowercase(Locale.US),
                    callType,
                    durationSeconds.toString(),
                    occurredAt
                ).joinToString("|")

                syncStore.enqueueCallLog(
                    CallLogRecordDto(
                        clientId = UUID.randomUUID().toString(),
                        fingerprint = fingerprintSource.hashFingerprint(),
                        contactName = contactName,
                        phoneNumber = phoneNumber,
                        callType = callType,
                        durationSeconds = durationSeconds,
                        occurredAt = occurredAt
                    )
                )
                count += 1
            }
        }

        count
    }

    fun hasCallLogPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            application,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            application,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun hasMicrophonePermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            application,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun hasNotificationAccess(): Boolean {
        val enabledListeners = Settings.Secure.getString(
            application.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false

        val componentName = ComponentName(application, NotificationCaptureService::class.java)
        return enabledListeners.contains(componentName.flattenToString())
    }

    fun hasShownNotificationAccessPrompt(): Boolean {
        return sessionStore.readNotificationAccessPromptShown()
    }

    fun markNotificationAccessPromptShown() {
        sessionStore.saveNotificationAccessPromptShown(true)
    }

    fun hasAutoStartSetupConfirmed(): Boolean {
        return sessionStore.readAutoStartSetupConfirmed()
    }

    fun markAutoStartSetupConfirmed(value: Boolean) {
        sessionStore.saveAutoStartSetupConfirmed(value)
    }

    suspend fun listPendingCommands(): List<DeviceCommandDto> = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext emptyList()

        val response = runCatching {
            apiClient.getPendingDeviceCommands(getApiBaseUrl(), storedSession.deviceToken)
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
        }.getOrElse {
            return@withContext emptyList()
        }

        response.commands.forEach { command ->
            syncStore.upsertCommand(command)
        }

        response.commands
    }

    suspend fun acknowledgeCommand(
        commandId: String,
        status: String,
        lastError: String? = null
    ): DeviceCommandDto? = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read() ?: return@withContext null

        val command = runCatching {
            apiClient.acknowledgeDeviceCommand(
                getApiBaseUrl(),
                storedSession.deviceToken,
                commandId,
                DeviceCommandAckRequestDto(status = status, lastError = lastError)
            )
        }.onFailure { throwable ->
            if (shouldClearStoredSession(throwable)) {
                sessionStore.clearStoredSession()
            }
        }.getOrNull() ?: return@withContext null

        syncStore.upsertCommand(command)
        command
    }

    suspend fun getLocationReportingEnabled(): Boolean = withContext(Dispatchers.IO) {
        syncStore.getBoolean(DeviceSyncStore.KEY_LOCATION_REPORTING_ENABLED, false)
    }

    suspend fun setLocationReportingEnabled(value: Boolean) = withContext(Dispatchers.IO) {
        syncStore.setBoolean(DeviceSyncStore.KEY_LOCATION_REPORTING_ENABLED, value)
    }

    suspend fun getLocationIntervalMinutes(): Int = withContext(Dispatchers.IO) {
        syncStore.getInt(
            DeviceSyncStore.KEY_LOCATION_INTERVAL_MINUTES,
            DeviceSyncStore.DEFAULT_LOCATION_INTERVAL_MINUTES
        )
    }

    suspend fun setLocationIntervalMinutes(value: Int) = withContext(Dispatchers.IO) {
        syncStore.setInt(DeviceSyncStore.KEY_LOCATION_INTERVAL_MINUTES, value)
    }

    private fun mapCallType(type: Int): String {
        return when (type) {
            CallLog.Calls.INCOMING_TYPE -> "incoming"
            CallLog.Calls.OUTGOING_TYPE -> "outgoing"
            CallLog.Calls.MISSED_TYPE -> "missed"
            CallLog.Calls.REJECTED_TYPE -> "rejected"
            CallLog.Calls.BLOCKED_TYPE -> "blocked"
            CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
            CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "answered_externally"
            else -> "unknown"
        }
    }

    private fun String.hashFingerprint(): String {
        return java.security.MessageDigest.getInstance("SHA-256")
            .digest(toByteArray())
            .joinToString("") { byte -> "%02x".format(byte) }
    }

    suspend fun unpairStoredSession() = withContext(Dispatchers.IO) {
        val storedSession = sessionStore.read()
        if (storedSession != null) {
            runCatching {
                apiClient.unpairSelf(getApiBaseUrl(), storedSession.deviceToken)
            }
        }
        sessionStore.clearStoredSession()
    }

    fun clearStoredSessionLocally() {
        sessionStore.clearStoredSession()
    }

    private fun normalizeApiBaseUrl(value: String): String {
        val trimmed = value.trim().removeSuffix("/")
        require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            "Server URL must start with http:// or https://"
        }
        return trimmed
    }

    private fun shouldClearStoredSession(throwable: Throwable): Boolean {
        if (throwable !is ApiException) {
            return false
        }

        if (throwable.statusCode != 401 && throwable.statusCode != 403) {
            return false
        }

        val message = throwable.message?.lowercase(Locale.US).orEmpty()
        return message.contains("device token") ||
            message.contains("device bearer token") ||
            message.contains("device session")
    }

    companion object {
        fun create(application: Application): DeviceRepository {
            return DeviceRepository(
                application = application,
                apiClient = ApiClient(),
                sessionStore = SecureSessionStore(application),
                metadataCollector = DeviceMetadataCollector(application),
                capabilityRegistry = CapabilityRegistry(),
                syncStore = DeviceSyncStore(application)
            )
        }
    }
}
