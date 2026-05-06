package com.safelens.app.service

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.safelens.app.SafeLensApplication
import com.safelens.app.data.CameraIceServerDto
import com.safelens.app.data.CameraStreamAudioChunkUploadDto
import com.safelens.app.data.CameraStreamDeviceStateUpdateDto
import com.safelens.app.data.CameraStreamFrameUploadDto
import com.safelens.app.data.CameraStreamSessionStateDto
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraEnumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.CapturerObserver
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.time.Instant
import kotlin.math.max
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class CameraStreamService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val repository by lazy {
        (application as SafeLensApplication).container.deviceRepository
    }
    private val streamLifecycleMutex = Mutex()
    private val peerConnectionMutex = Mutex()
    private val peerConnections = linkedMapOf<String, PeerConnection>()
    private var realtimeSocket: Socket? = null
    private var sessionState: CameraStreamSessionStateDto? = null
    private var currentSessionId: String? = null
    private var preferredTransport: String = DEFAULT_PREFERRED_TRANSPORT
    private var cameraFacing: String = DEFAULT_CAMERA_FACING
    private var includeAudio: Boolean = false
    private var mjpegFrameIntervalMs: Int = DEFAULT_MJPEG_FRAME_INTERVAL_MS
    private var mjpegLastUploadedAtMs: Long = 0L
    private var mjpegUploadInFlight = false
    private val mjpegUploadLock = Any()
    private var signalingReady = false
    private var foregroundStartupBlocked = false

    private var eglBase: EglBase? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var audioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var audioFallbackCaptureJob: Job? = null
    private var audioFallbackSequence: Int = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val foregroundFailure =
            runCatching { startForegroundWithCurrentType(isStreaming = false) }.exceptionOrNull()
        if (foregroundFailure != null) {
            val status =
                if (
                    foregroundFailure is ForegroundServiceStartNotAllowedException ||
                        foregroundFailure is SecurityException
                ) {
                    "activation_blocked"
                } else {
                    "failed"
                }
            val message =
                normalizeErrorMessage(
                    foregroundFailure.message,
                    if (status == "activation_blocked") {
                        "Android blocked camera foreground-service startup."
                    } else {
                        "Camera foreground service failed to start."
                    }
                )
            val errorCode =
                if (status == "activation_blocked") {
                    ERROR_FGS_START_BLOCKED
                } else {
                    ERROR_SIGNALING_FAILED
                }
            Log.e(TAG, "Unable to start camera foreground service.", foregroundFailure)
            foregroundStartupBlocked = true
            running = false
            armed = false
            activeSessionId = null
            signalingReadySessionId = null
            failureSessionId = null
            lastFailureCode = errorCode
            lastFailureMessage = message
            serviceScope.launch {
                reportState(
                    status = status,
                    signalingReady = false,
                    lastErrorCode = errorCode,
                    lastError = message
                )
                stopSelf()
            }
            return
        }

        foregroundStartupBlocked = false
        running = true
        armed = true
        activeSessionId = null
        signalingReadySessionId = null
        failureSessionId = null
        lastFailureCode = null
        lastFailureMessage = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (foregroundStartupBlocked) {
            return START_NOT_STICKY
        }

        val startIntent = intent
        when (startIntent?.action ?: ACTION_ARM_SERVICE) {
            ACTION_DISARM_SERVICE -> {
                serviceScope.launch {
                    disarmService()
                }
                return START_NOT_STICKY
            }

            ACTION_STOP_STREAM_SESSION, ACTION_STOP -> {
                serviceScope.launch {
                    stopStreamingSession()
                }
                return START_STICKY
            }

            ACTION_ARM_SERVICE -> {
                serviceScope.launch {
                    armService()
                }
                return START_STICKY
            }

            ACTION_START_STREAM_SESSION, ACTION_START -> {
                currentSessionId = startIntent?.getStringExtra(EXTRA_CAMERA_SESSION_ID)
                cameraFacing =
                    startIntent?.getStringExtra(EXTRA_CAMERA_FACING)
                        ?.takeIf { it == "front" || it == "back" }
                        ?: cameraFacing
                includeAudio =
                    startIntent?.getBooleanExtra(EXTRA_INCLUDE_AUDIO, includeAudio)
                        ?: includeAudio
                preferredTransport =
                    startIntent?.getStringExtra(EXTRA_PREFERRED_TRANSPORT)
                        ?.takeIf { it == "mjpeg" }
                        ?: DEFAULT_PREFERRED_TRANSPORT
                mjpegFrameIntervalMs =
                    max(
                        250,
                        startIntent?.getIntExtra(EXTRA_FRAME_INTERVAL_MS, mjpegFrameIntervalMs)
                            ?: mjpegFrameIntervalMs
                    )

                serviceScope.launch {
                    startOrRestartStreaming()
                }
                return START_STICKY
            }

            else -> return START_STICKY
        }
    }

    override fun onDestroy() {
        running = false
        armed = false
        activeSessionId = null
        signalingReadySessionId = null
        failureSessionId = null
        lastFailureCode = null
        lastFailureMessage = null
        disconnectRealtimeSocket()
        serviceScope.launch {
            cleanupPeerConnections()
        }
        stopCaptureComponents()
        serviceScope.cancel()
        super.onDestroy()
    }

    private suspend fun armService() {
        streamLifecycleMutex.withLock {
            armed = true
            updateForegroundNotification(isStreaming = currentSessionId != null)
            if (currentSessionId == null) {
                failureSessionId = null
                lastFailureCode = null
                lastFailureMessage = null
                reportState(
                    status = "idle",
                    signalingReady = false,
                    lastErrorCode = null,
                    lastError = null
                )
            }
        }
    }

    private suspend fun disarmService() {
        streamLifecycleMutex.withLock {
            disconnectRealtimeSocket()
            cleanupPeerConnections()
            stopCaptureComponents()
            signalingReady = false
            currentSessionId = null
            sessionState = null
            armed = false
            activeSessionId = null
            signalingReadySessionId = null
            failureSessionId = null
            lastFailureCode = null
            lastFailureMessage = null
            stopForegroundCompat()
            stopSelf()
        }
    }

    private suspend fun startOrRestartStreaming() {
        streamLifecycleMutex.withLock {
            if (!armed) {
                failSession(
                    message = "Camera service is not armed. Open the SafeLens app once to arm camera streaming.",
                    status = "activation_blocked",
                    errorCode = ERROR_SERVICE_NOT_ARMED
                )
                return
            }

            if (!repository.hasCameraPermission()) {
                failSession(
                    message = "Camera permission is not granted on the device.",
                    status = "failed",
                    errorCode = ERROR_CAMERA_PERMISSION_MISSING
                )
                return
            }

            signalingReady = false
            signalingReadySessionId = null
            failureSessionId = null
            lastFailureCode = null
            lastFailureMessage = null
            activeSessionId = currentSessionId
            reportState(
                status = "starting",
                signalingReady = false,
                lastErrorCode = null,
                lastError = null
            )

            runCatching {
                val freshSessionState = repository.getSelfCameraStreamSession()
                sessionState = freshSessionState
                currentSessionId = freshSessionState.sessionId
                activeSessionId = freshSessionState.sessionId
                cameraFacing = freshSessionState.cameraFacing
                includeAudio = freshSessionState.includeAudio
                preferredTransport = DEFAULT_PREFERRED_TRANSPORT
                Log.i(
                    TAG,
                    "Starting camera stream sessionId=${freshSessionState.sessionId ?: "null"} transport=${freshSessionState.preferredTransport} includeAudio=${freshSessionState.includeAudio} micPermission=${repository.hasMicrophonePermission()}."
                )
                updateForegroundNotification(isStreaming = true)

                if (freshSessionState.sessionId == null) {
                    error("Camera session is no longer active.")
                }

                cleanupPeerConnections()
                stopCaptureComponents()
                startLocalMediaMjpegOnly()
                disconnectRealtimeSocket()

                signalingReady = true
                signalingReadySessionId = freshSessionState.sessionId
                reportState(
                    status = "starting",
                    signalingReady = true,
                    lastErrorCode = null,
                    lastError = null
                )
            }.onFailure { throwable ->
                Log.e(TAG, "Unable to start camera streaming.", throwable)
                val status =
                    when (throwable) {
                        is SecurityException,
                        is ForegroundServiceStartNotAllowedException -> "activation_blocked"
                        else -> "failed"
                    }
                val errorCode =
                    when (throwable) {
                        is CameraOpenFailureException -> ERROR_CAMERA_OPEN_FAILED
                        is SecurityException,
                        is ForegroundServiceStartNotAllowedException -> ERROR_FGS_START_BLOCKED
                        else -> ERROR_SIGNALING_FAILED
                    }
                val fallbackMessage =
                    when (errorCode) {
                        ERROR_CAMERA_OPEN_FAILED -> "Camera could not be opened for streaming."
                        ERROR_FGS_START_BLOCKED ->
                            "Android blocked camera activation while the app was in background."
                        ERROR_SIGNALING_FAILED -> "Camera signaling failed to start."
                        else -> "Camera stream failed to start."
                    }
                failSession(
                    message = normalizeErrorMessage(throwable.message, fallbackMessage) ?: fallbackMessage,
                    status = status,
                    errorCode = errorCode
                )
            }
        }
    }

    private fun ensurePeerConnectionFactory() {
        if (peerConnectionFactory != null) {
            return
        }

        val initializationOptions =
            PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                .createInitializationOptions()
        PeerConnectionFactory.initialize(initializationOptions)

        val nextEglBase = EglBase.create()
        val encoderFactory = DefaultVideoEncoderFactory(nextEglBase.eglBaseContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(nextEglBase.eglBaseContext)

        peerConnectionFactory =
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(encoderFactory)
                .setVideoDecoderFactory(decoderFactory)
                .createPeerConnectionFactory()
        eglBase = nextEglBase
    }

    private suspend fun startLocalMedia(freshSessionState: CameraStreamSessionStateDto) {
        stopAudioFallbackCapture()
        val factory = peerConnectionFactory ?: error("Peer connection factory is unavailable.")
        val nextSurfaceTextureHelper =
            SurfaceTextureHelper.create("SafeLensCameraCapture", eglBase?.eglBaseContext)
        val nextCapturer =
            createVideoCapturer(cameraFacing)
                ?: throw CameraOpenFailureException(
                    "No compatible camera capturer is available on this device."
                )
        val nextVideoSource = factory.createVideoSource(false)
        nextCapturer.initialize(
            nextSurfaceTextureHelper,
            applicationContext,
            nextVideoSource.capturerObserver
        )
        runCatching {
            nextCapturer.startCapture(
                DEFAULT_CAPTURE_WIDTH,
                DEFAULT_CAPTURE_HEIGHT,
                DEFAULT_CAPTURE_FPS
            )
        }.getOrElse { throwable ->
            runCatching { nextCapturer.dispose() }
            runCatching { nextSurfaceTextureHelper.dispose() }
            runCatching { nextVideoSource.dispose() }
            throw CameraOpenFailureException(
                throwable.message ?: "Camera capture failed to start.",
                throwable
            )
        }

        val nextVideoTrack = factory.createVideoTrack(VIDEO_TRACK_ID, nextVideoSource)
        synchronized(mjpegUploadLock) {
            mjpegUploadInFlight = false
            mjpegLastUploadedAtMs = 0L
        }
        nextVideoTrack.addSink(
            MjpegUploadSink { frame ->
                handleMjpegUploadFrame(frame)
            }
        )

        val wantsAudio = freshSessionState.includeAudio
        val canSendAudio = wantsAudio && repository.hasMicrophonePermission()
        Log.i(
            TAG,
            "Preparing local media sessionId=${freshSessionState.sessionId ?: "null"} wantsAudio=$wantsAudio canSendAudio=$canSendAudio."
        )
        val nextAudioSource =
            if (canSendAudio) {
                factory.createAudioSource(MediaConstraints())
            } else {
                null
            }
        val nextAudioTrack =
            nextAudioSource?.let { audio ->
                factory.createAudioTrack(AUDIO_TRACK_ID, audio)
            }
        nextAudioTrack?.setEnabled(true)
        Log.i(
            TAG,
            "Local media tracks prepared videoTrack=${nextVideoTrack.id()} audioTrack=${nextAudioTrack?.id() ?: "none"}."
        )

        surfaceTextureHelper = nextSurfaceTextureHelper
        videoCapturer = nextCapturer
        videoSource = nextVideoSource
        localVideoTrack = nextVideoTrack
        audioSource = nextAudioSource
        localAudioTrack = nextAudioTrack

        reportState(
            status = "starting",
            audioAvailable = canSendAudio,
            lastErrorCode = null,
            lastError = null
        )
    }

    private suspend fun startLocalMediaMjpegOnly() {
        ensureWebRtcInitialized()
        val nextEglBase = EglBase.create()
        stopAudioFallbackCapture()
        val nextSurfaceTextureHelper =
            SurfaceTextureHelper.create("SafeLensCameraCapture", nextEglBase.eglBaseContext)
        val nextCapturer =
            createVideoCapturer(cameraFacing)
                ?: throw CameraOpenFailureException(
                    "No compatible camera capturer is available on this device."
                )

        val capturerObserver =
            object : CapturerObserver {
                override fun onCapturerStarted(success: Boolean) {
                    if (!success) {
                        Log.e(TAG, "MJPEG camera capturer failed to start.")
                    }
                }

                override fun onCapturerStopped() {
                    // No-op.
                }

                override fun onFrameCaptured(frame: VideoFrame?) {
                    frame ?: return
                    handleMjpegUploadFrame(frame)
                }
            }

        nextCapturer.initialize(nextSurfaceTextureHelper, applicationContext, capturerObserver)
        runCatching {
            nextCapturer.startCapture(
                DEFAULT_CAPTURE_WIDTH,
                DEFAULT_CAPTURE_HEIGHT,
                DEFAULT_CAPTURE_FPS
            )
        }.getOrElse { throwable ->
            runCatching { nextCapturer.dispose() }
            runCatching { nextSurfaceTextureHelper.dispose() }
            runCatching { nextEglBase.release() }
            throw CameraOpenFailureException(
                throwable.message ?: "Camera capture failed to start.",
                throwable
            )
        }

        synchronized(mjpegUploadLock) {
            mjpegUploadInFlight = false
            mjpegLastUploadedAtMs = 0L
        }

        eglBase = nextEglBase
        surfaceTextureHelper = nextSurfaceTextureHelper
        videoCapturer = nextCapturer
        videoSource = null
        localVideoTrack = null
        audioSource = null
        localAudioTrack = null

        val canSendAudio = includeAudio && repository.hasMicrophonePermission()
        val audioFallbackStarted =
            if (canSendAudio) {
                startAudioFallbackCapture(currentSessionId)
            } else {
                false
            }

        reportState(
            status = "starting",
            audioAvailable = audioFallbackStarted,
            lastErrorCode = null,
            lastError = null
        )
    }

    private fun startAudioFallbackCapture(cameraSessionId: String?): Boolean {
        if (!includeAudio || cameraSessionId.isNullOrBlank()) {
            Log.w(
                TAG,
                "Audio fallback not started: includeAudio=$includeAudio sessionId=${cameraSessionId ?: "null"}."
            )
            return false
        }

        if (!repository.hasMicrophonePermission()) {
            Log.w(TAG, "Audio fallback not started: RECORD_AUDIO permission missing.")
            return false
        }

        val minBufferSize =
            AudioRecord.getMinBufferSize(
                AUDIO_FALLBACK_SAMPLE_RATE_HZ,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
        if (minBufferSize <= 0) {
            Log.w(TAG, "Audio fallback buffer size is unavailable. Audio fallback disabled.")
            return false
        }

        val chunkSizeBytes =
            (AUDIO_FALLBACK_SAMPLE_RATE_HZ * AUDIO_FALLBACK_CHUNK_MS / 1000) *
                (AUDIO_FALLBACK_BITS_PER_SAMPLE / 8)
        val bufferSizeBytes = max(minBufferSize, chunkSizeBytes * 2)
        val audioRecord =
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                AUDIO_FALLBACK_SAMPLE_RATE_HZ,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSizeBytes
            )

        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            Log.w(TAG, "Audio fallback recorder initialization failed.")
            runCatching { audioRecord.release() }
            return false
        }

        Log.i(
            TAG,
            "Starting audio fallback capture for sessionId=$cameraSessionId sampleRate=${AUDIO_FALLBACK_SAMPLE_RATE_HZ}Hz."
        )

        audioFallbackSequence = 0
        audioFallbackCaptureJob =
            serviceScope.launch {
                val readBuffer = ByteArray(chunkSizeBytes)
                var recordingStarted = false
                try {
                    audioRecord.startRecording()
                    recordingStarted = true

                    if (audioRecord.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                        Log.e(TAG, "Audio fallback failed to enter recording state.")
                        return@launch
                    }

                    while (
                        isActive &&
                            includeAudio &&
                            currentSessionId == cameraSessionId
                    ) {
                        val bytesRead = audioRecord.read(readBuffer, 0, readBuffer.size)
                        if (bytesRead <= 0) {
                            continue
                        }

                        val payloadBytes =
                            if (bytesRead == readBuffer.size) {
                                readBuffer
                            } else {
                                readBuffer.copyOf(bytesRead)
                            }
                        val sequence = audioFallbackSequence
                        audioFallbackSequence += 1
                        runCatching {
                            repository.uploadCameraStreamAudioChunk(
                                CameraStreamAudioChunkUploadDto(
                                    capturedAt = Instant.now().toString(),
                                    sequence = sequence,
                                    sampleRateHz = AUDIO_FALLBACK_SAMPLE_RATE_HZ,
                                    channels = AUDIO_FALLBACK_CHANNELS,
                                    bitsPerSample = AUDIO_FALLBACK_BITS_PER_SAMPLE,
                                    pcm16Base64 =
                                        Base64.encodeToString(payloadBytes, Base64.NO_WRAP),
                                    cameraSessionId = cameraSessionId
                                )
                            )
                            if (sequence == 0 || sequence % 25 == 0) {
                                Log.i(
                                    TAG,
                                    "Uploaded audio fallback chunk sequence=$sequence sessionId=$cameraSessionId bytes=${payloadBytes.size}."
                                )
                            }
                        }.onFailure { throwable ->
                            Log.e(TAG, "Unable to upload camera audio fallback chunk.", throwable)
                        }
                    }
                } catch (throwable: Throwable) {
                    Log.e(TAG, "Audio fallback capture failed.", throwable)
                } finally {
                    if (recordingStarted) {
                        runCatching { audioRecord.stop() }
                    }
                    runCatching { audioRecord.release() }
                }
            }

        return true
    }

    private fun stopAudioFallbackCapture() {
        audioFallbackCaptureJob?.cancel()
        audioFallbackCaptureJob = null
        audioFallbackSequence = 0
    }

    private fun ensureWebRtcInitialized() {
        val initializationOptions =
            PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                .createInitializationOptions()
        PeerConnectionFactory.initialize(initializationOptions)
    }

    private fun handleMjpegUploadFrame(frame: VideoFrame) {
        val now = SystemClock.elapsedRealtime()
        val shouldUpload =
            synchronized(mjpegUploadLock) {
                if (mjpegUploadInFlight) {
                    false
                } else if (now - mjpegLastUploadedAtMs < mjpegFrameIntervalMs.toLong()) {
                    false
                } else {
                    mjpegUploadInFlight = true
                    mjpegLastUploadedAtMs = now
                    true
                }
            }

        if (!shouldUpload) {
            return
        }

        frame.retain()
        serviceScope.launch {
            uploadMjpegFrame(frame)
        }
    }

    private suspend fun uploadMjpegFrame(frame: VideoFrame) {
        runCatching {
            val width = frame.buffer.width
            val height = frame.buffer.height
            val jpegBytes = encodeFrameToJpeg(frame)
            repository.uploadCameraStreamFrame(
                CameraStreamFrameUploadDto(
                    capturedAt = Instant.now().toString(),
                    imageBase64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP),
                    width = width,
                    height = height,
                    cameraFacing = cameraFacing
                )
            )
        }.onFailure { throwable ->
            Log.e(TAG, "Unable to upload MJPEG fallback frame.", throwable)
        }.also {
            frame.release()
            synchronized(mjpegUploadLock) {
                mjpegUploadInFlight = false
            }
        }
    }

    private suspend fun handleDeviceSignal(payload: JSONObject) {
        val viewerId = payload.optString("viewerId")
        if (viewerId.isBlank()) {
            return
        }

        val signal = payload.optJSONObject("signal") ?: return
        when (signal.optString("type")) {
            "offer" -> {
                val sdp = signal.optString("sdp")
                if (sdp.isBlank()) {
                    return
                }
                handleOffer(viewerId, sdp)
            }

            "ice-candidate" -> {
                val candidate = signal.optString("candidate")
                if (candidate.isBlank()) {
                    return
                }
                val iceCandidate =
                    IceCandidate(
                        signal.optString("sdpMid").takeIf { it.isNotBlank() },
                        signal.optInt("sdpMLineIndex", 0),
                        candidate
                    )
                peerConnectionMutex.withLock {
                    peerConnections[viewerId]?.addIceCandidate(iceCandidate)
                }
            }
        }
    }

    private suspend fun handleOffer(viewerId: String, sdp: String) {
        val connection = createOrReplacePeerConnection(viewerId)
        setRemoteDescription(
            connection,
            SessionDescription(SessionDescription.Type.OFFER, sdp)
        )

        val answer = createAnswer(connection)
        setLocalDescription(connection, answer)
        emitSignalToViewer(
            viewerId,
            JSONObject()
                .put("type", "answer")
                .put("sdp", answer.description)
        )
        reportState("starting", lastError = null)
    }

    private suspend fun createOrReplacePeerConnection(viewerId: String): PeerConnection {
        val factory = peerConnectionFactory ?: error("Peer connection factory is unavailable.")
        val rtcConfig = PeerConnection.RTCConfiguration(buildIceServers())
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN

        val nextConnection =
            factory.createPeerConnection(
                rtcConfig,
                object : PeerConnection.Observer {
                    override fun onIceCandidate(candidate: IceCandidate?) {
                        candidate ?: return
                        serviceScope.launch {
                            emitSignalToViewer(
                                viewerId,
                                JSONObject()
                                    .put("type", "ice-candidate")
                                    .put("candidate", candidate.sdp)
                                    .put("sdpMid", candidate.sdpMid)
                                    .put("sdpMLineIndex", candidate.sdpMLineIndex)
                            )
                        }
                    }

                    override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                        if (newState == PeerConnection.PeerConnectionState.FAILED) {
                            serviceScope.launch {
                                reportState(
                                    status = "failed",
                                    lastErrorCode = ERROR_SIGNALING_FAILED,
                                    lastError = "WebRTC peer connection failed for viewer $viewerId."
                                )
                            }
                        }
                    }

                    override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {}
                    override fun onSignalingChange(newState: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                    override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {}
                    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
                    override fun onAddStream(stream: org.webrtc.MediaStream?) {}
                    override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}
                    override fun onDataChannel(dataChannel: org.webrtc.DataChannel?) {}
                    override fun onRenegotiationNeeded() {}
                    override fun onAddTrack(
                        receiver: RtpReceiver?,
                        mediaStreams: Array<out org.webrtc.MediaStream>?
                    ) {}
                    override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) {}
                }
            ) ?: error("Unable to create peer connection.")

        localVideoTrack?.let { videoTrack ->
            nextConnection.addTrack(videoTrack, listOf(MEDIA_STREAM_ID))
        }
        localAudioTrack?.let { audioTrack ->
            nextConnection.addTrack(audioTrack, listOf(MEDIA_STREAM_ID))
        }
        Log.i(
            TAG,
            "Peer connection prepared for viewerId=$viewerId localVideo=${localVideoTrack != null} localAudio=${localAudioTrack != null}."
        )

        peerConnectionMutex.withLock {
            peerConnections.remove(viewerId)?.close()
            peerConnections[viewerId] = nextConnection
        }

        return nextConnection
    }

    private suspend fun createAnswer(connection: PeerConnection): SessionDescription {
        return suspendCoroutineSdp { observer ->
            connection.createAnswer(observer, MediaConstraints())
        }
    }

    private suspend fun emitSignalToViewer(viewerId: String, signal: JSONObject) {
        realtimeSocket?.emit(
            "camera.device.signal",
            JSONObject()
                .put("viewerId", viewerId)
                .put("signal", signal)
        )
    }

    private suspend fun connectRealtimeSocket() {
        if (realtimeSocket?.connected() == true && signalingReady) {
            return
        }

        disconnectRealtimeSocket()

        val storedSession = repository.getStoredSession()
            ?: error("Device session unavailable for camera signaling.")
        val socketOptions =
            IO.Options.builder()
                .setTransports(arrayOf(WebSocket.NAME))
                .setReconnection(true)
                .setReconnectionAttempts(4)
                .setTimeout(SOCKET_CONNECT_TIMEOUT_MS)
                .build()
        val socket = IO.socket(repository.getApiBaseUrl(), socketOptions)
        realtimeSocket = socket

        socket.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val message =
                args.firstOrNull()?.toString()?.takeIf { it.isNotBlank() }
                    ?: "Socket connect error."
            Log.e(TAG, "Camera signaling socket connect error: $message")
        }

        socket.on("camera.device.signal") { args ->
            val rawPayload = args.firstOrNull() ?: return@on
            val payload =
                when (rawPayload) {
                    is JSONObject -> rawPayload
                    else -> runCatching { JSONObject(rawPayload.toString()) }.getOrNull()
                } ?: return@on

            serviceScope.launch {
                runCatching {
                    handleDeviceSignal(payload)
                }.onFailure { throwable ->
                    Log.e(TAG, "Unable to handle camera device signal.", throwable)
                }
            }
        }

        withTimeout(SOCKET_CONNECT_TIMEOUT_MS) {
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { continuation ->
                val handleConnect: (Array<Any>) -> Unit = {
                    socket.emit(
                        "device.subscribe",
                        JSONObject().put("deviceToken", storedSession.deviceToken)
                    )
                }
                val handleSubscribeOk: (Array<Any>) -> Unit = {
                    if (continuation.isActive) {
                        continuation.resume(Unit)
                    }
                }
                val handleSubscribeFailed: (Array<Any>) -> Unit = { args ->
                    val message =
                        args.firstOrNull()?.toString()?.takeIf { it.isNotBlank() }
                            ?: "Camera signaling subscription failed."
                    if (continuation.isActive) {
                        continuation.resumeWithException(IllegalStateException(message))
                    }
                }
                val handleConnectError: (Array<Any>) -> Unit = { args ->
                    val message =
                        args.firstOrNull()?.toString()?.takeIf { it.isNotBlank() }
                            ?: "Camera socket connection failed."
                    if (continuation.isActive) {
                        continuation.resumeWithException(IllegalStateException(message))
                    }
                }

                socket.on(Socket.EVENT_CONNECT, handleConnect)
                socket.on("device.subscribe.ok", handleSubscribeOk)
                socket.on("device.subscribe.failed", handleSubscribeFailed)
                socket.on(Socket.EVENT_CONNECT_ERROR, handleConnectError)

                continuation.invokeOnCancellation {
                    socket.off(Socket.EVENT_CONNECT, handleConnect)
                    socket.off("device.subscribe.ok", handleSubscribeOk)
                    socket.off("device.subscribe.failed", handleSubscribeFailed)
                    socket.off(Socket.EVENT_CONNECT_ERROR, handleConnectError)
                }

                socket.connect()
            }
        }
    }

    private fun disconnectRealtimeSocket() {
        signalingReady = false
        realtimeSocket?.disconnect()
        realtimeSocket?.close()
        realtimeSocket = null
    }

    private suspend fun stopStreamingSession() {
        streamLifecycleMutex.withLock {
            disconnectRealtimeSocket()
            cleanupPeerConnections()
            stopCaptureComponents()
            val previousSessionId = currentSessionId ?: activeSessionId
            signalingReady = false
            currentSessionId = null
            sessionState = null
            activeSessionId = null
            signalingReadySessionId = null
            failureSessionId = null
            lastFailureCode = null
            lastFailureMessage = null
            updateForegroundNotification(isStreaming = false)
            reportState(
                status = "idle",
                signalingReady = false,
                cameraSessionId = previousSessionId,
                lastErrorCode = null,
                lastError = null
            )
        }
    }

    private suspend fun failSession(message: String, status: String, errorCode: String) {
        disconnectRealtimeSocket()
        cleanupPeerConnections()
        stopCaptureComponents()
        signalingReady = false
        signalingReadySessionId = null
        failureSessionId = currentSessionId ?: activeSessionId
        lastFailureCode = errorCode
        lastFailureMessage = normalizeErrorMessage(message)
        updateForegroundNotification(isStreaming = false)
        reportState(
            status = status,
            signalingReady = false,
            lastErrorCode = errorCode,
            lastError = lastFailureMessage
        )
    }

    private suspend fun cleanupPeerConnections() {
        peerConnectionMutex.withLock {
            peerConnections.values.forEach { connection ->
                runCatching { connection.close() }
            }
            peerConnections.clear()
        }
    }

    private fun stopCaptureComponents() {
        stopAudioFallbackCapture()
        runCatching { videoCapturer?.stopCapture() }
        runCatching { videoCapturer?.dispose() }
        runCatching { surfaceTextureHelper?.dispose() }
        runCatching { localVideoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { localAudioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { peerConnectionFactory?.dispose() }
        runCatching { eglBase?.release() }

        videoCapturer = null
        surfaceTextureHelper = null
        localVideoTrack = null
        videoSource = null
        localAudioTrack = null
        audioSource = null
        peerConnectionFactory = null
        eglBase = null
    }

    private suspend fun reportState(
        status: String,
        audioAvailable: Boolean? = null,
        signalingReady: Boolean? = null,
        cameraSessionId: String? = currentSessionId ?: activeSessionId,
        lastErrorCode: String? = null,
        lastError: String?
    ) {
        val normalizedLastError = normalizeErrorMessage(lastError)
        runCatching {
            repository.updateCameraStreamState(
                CameraStreamDeviceStateUpdateDto(
                    status = status,
                    cameraFacing = cameraFacing,
                    includeAudio = includeAudio,
                    audioAvailable = audioAvailable ?: (includeAudio && repository.hasMicrophonePermission()),
                    signalingReady = signalingReady ?: this.signalingReady,
                    preferredTransport = preferredTransport,
                    cameraSessionId = cameraSessionId,
                    lastErrorCode = lastErrorCode,
                    lastError = normalizedLastError
                )
            )
        }.onFailure { throwable ->
            Log.e(TAG, "Unable to publish camera stream state.", throwable)
        }
    }

    private fun normalizeErrorMessage(
        value: String?,
        fallback: String? = null
    ): String? {
        val trimmed = value?.trim().orEmpty()
        val candidate =
            when {
                trimmed.length >= 2 -> trimmed
                fallback != null -> fallback
                else -> null
            }

        return candidate?.take(MAX_REMOTE_ERROR_LENGTH)
    }

    private fun buildIceServers(): List<PeerConnection.IceServer> {
        val currentState = sessionState
        return currentState?.iceServers?.mapNotNull { server ->
            buildIceServer(server)
        } ?: emptyList()
    }

    private fun buildIceServer(server: CameraIceServerDto): PeerConnection.IceServer? {
        if (server.urls.isEmpty()) {
            return null
        }

        val builder = PeerConnection.IceServer.builder(server.urls)
        server.username?.let { builder.setUsername(it) }
        server.credential?.let { builder.setPassword(it) }
        return builder.createIceServer()
    }

    private fun createVideoCapturer(requestedFacing: String): CameraVideoCapturer? {
        val camera1Enumerator = Camera1Enumerator(true)
        createCapturerWithEnumerator(camera1Enumerator, requestedFacing)?.let {
            return it
        }

        val camera2Enumerator = Camera2Enumerator(applicationContext)
        return createCapturerWithEnumerator(camera2Enumerator, requestedFacing)
    }

    private fun createCapturerWithEnumerator(
        enumerator: CameraEnumerator,
        requestedFacing: String
    ): CameraVideoCapturer? {
        val preferredDevice =
            enumerator.deviceNames.firstOrNull { name ->
                if (requestedFacing == "front") {
                    enumerator.isFrontFacing(name)
                } else {
                    enumerator.isBackFacing(name)
                }
            }
        val fallbackDevice =
            enumerator.deviceNames.firstOrNull { name ->
                if (requestedFacing == "front") {
                    enumerator.isBackFacing(name)
                } else {
                    enumerator.isFrontFacing(name)
                }
            }
        val deviceName = preferredDevice ?: fallbackDevice ?: return null
        val capturer = enumerator.createCapturer(deviceName, null) ?: return null
        cameraFacing =
            if (enumerator.isFrontFacing(deviceName)) {
                "front"
            } else {
                "back"
            }
        return capturer
    }

    private fun encodeFrameToJpeg(frame: VideoFrame): ByteArray {
        val i420Buffer = frame.buffer.toI420() ?: error("Unable to convert frame to I420.")
        return try {
            val width = i420Buffer.width
            val height = i420Buffer.height
            val nv21 = i420ToNv21(i420Buffer)
            val yuvImage = YuvImage(nv21, ImageFormat.NV21, width, height, null)
            val outputStream = ByteArrayOutputStream()
            yuvImage.compressToJpeg(Rect(0, 0, width, height), JPEG_QUALITY, outputStream)
            outputStream.toByteArray()
        } finally {
            i420Buffer.release()
        }
    }

    private fun i420ToNv21(buffer: VideoFrame.I420Buffer): ByteArray {
        val width = buffer.width
        val height = buffer.height
        val ySize = width * height
        val uvWidth = width / 2
        val uvHeight = height / 2
        val output = ByteArray(ySize + (uvWidth * uvHeight * 2))

        copyPlane(buffer.dataY, buffer.strideY, output, 0, width, height)

        val uBytes = ByteArray(uvWidth)
        val vBytes = ByteArray(uvWidth)
        val uBuffer = buffer.dataU.duplicate()
        val vBuffer = buffer.dataV.duplicate()
        var chromaOffset = ySize

        for (row in 0 until uvHeight) {
            uBuffer.position(row * buffer.strideU)
            vBuffer.position(row * buffer.strideV)
            uBuffer.get(uBytes, 0, uvWidth)
            vBuffer.get(vBytes, 0, uvWidth)

            for (column in 0 until uvWidth) {
                output[chromaOffset++] = vBytes[column]
                output[chromaOffset++] = uBytes[column]
            }
        }

        return output
    }

    private fun copyPlane(
        source: ByteBuffer,
        stride: Int,
        target: ByteArray,
        targetOffset: Int,
        width: Int,
        height: Int
    ) {
        val rowBuffer = ByteArray(width)
        val duplicateSource = source.duplicate()
        var outputOffset = targetOffset

        for (row in 0 until height) {
            duplicateSource.position(row * stride)
            duplicateSource.get(rowBuffer, 0, width)
            rowBuffer.copyInto(target, outputOffset)
            outputOffset += width
        }
    }

    private fun buildNotification(isStreaming: Boolean): Notification {
        val message =
            if (isStreaming) {
                "Remote camera streaming is active."
            } else {
                "Camera service armed for remote streaming."
            }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SafeLens camera session")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setOngoing(true)
            .build()
    }

    private fun startForegroundWithCurrentType(isStreaming: Boolean) {
        val notification = buildNotification(isStreaming = isStreaming)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var serviceTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            if (repository.hasMicrophonePermission()) {
                serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            startForeground(
                NOTIFICATION_ID,
                notification,
                serviceTypes
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateForegroundNotification(isStreaming: Boolean) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(isStreaming = isStreaming))
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "SafeLens camera stream",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val ACTION_ARM_SERVICE = "camera_stream_arm_service"
        private const val ACTION_START_STREAM_SESSION = "camera_stream_start_session"
        private const val ACTION_STOP_STREAM_SESSION = "camera_stream_stop_session"
        private const val ACTION_DISARM_SERVICE = "camera_stream_disarm_service"
        private const val ACTION_START = "camera_stream_start"
        private const val ACTION_STOP = "camera_stream_stop"
        private const val EXTRA_CAMERA_FACING = "camera_facing"
        private const val EXTRA_INCLUDE_AUDIO = "include_audio"
        private const val EXTRA_PREFERRED_TRANSPORT = "preferred_transport"
        private const val EXTRA_CAMERA_SESSION_ID = "camera_session_id"
        private const val EXTRA_FRAME_INTERVAL_MS = "frame_interval_ms"
        private const val DEFAULT_CAMERA_FACING = "back"
        private const val DEFAULT_PREFERRED_TRANSPORT = "mjpeg"
        private const val DEFAULT_MJPEG_FRAME_INTERVAL_MS = 500
        private const val DEFAULT_CAPTURE_WIDTH = 640
        private const val DEFAULT_CAPTURE_HEIGHT = 480
        private const val DEFAULT_CAPTURE_FPS = 24
        private const val JPEG_QUALITY = 55
        private const val CHANNEL_ID = "safelens-camera-stream"
        private const val NOTIFICATION_ID = 67
        private const val VIDEO_TRACK_ID = "SLVideoTrack"
        private const val AUDIO_TRACK_ID = "SLAudioTrack"
        private const val MEDIA_STREAM_ID = "safelens-media-stream"
        private const val SOCKET_CONNECT_TIMEOUT_MS = 10_000L
        private const val MAX_REMOTE_ERROR_LENGTH = 1024
        private const val AUDIO_FALLBACK_SAMPLE_RATE_HZ = 16_000
        private const val AUDIO_FALLBACK_CHANNELS = 1
        private const val AUDIO_FALLBACK_BITS_PER_SAMPLE = 16
        private const val AUDIO_FALLBACK_CHUNK_MS = 120
        private const val TAG = "CameraStreamService"
        private const val ERROR_SERVICE_NOT_ARMED = "service_not_armed"
        private const val ERROR_FGS_START_BLOCKED = "fgs_start_blocked"
        private const val ERROR_CAMERA_PERMISSION_MISSING = "camera_permission_missing"
        private const val ERROR_CAMERA_OPEN_FAILED = "camera_open_failed"
        private const val ERROR_SIGNALING_FAILED = "signaling_failed"
        private const val ERROR_START_TIMEOUT = "start_timeout"
        @Volatile
        private var running = false
        @Volatile
        private var armed = false
        @Volatile
        private var activeSessionId: String? = null
        @Volatile
        private var signalingReadySessionId: String? = null
        @Volatile
        private var failureSessionId: String? = null
        @Volatile
        private var lastFailureCode: String? = null
        @Volatile
        private var lastFailureMessage: String? = null

        fun arm(context: Context): StartRequestResult {
            if (running && armed) {
                failureSessionId = null
                lastFailureCode = null
                lastFailureMessage = null
                return StartRequestResult(
                    success = true,
                    status = "idle",
                    message = null,
                    errorCode = null
                )
            }
            val intent = Intent(context, CameraStreamService::class.java).apply {
                action = ACTION_ARM_SERVICE
            }

            return try {
                ContextCompat.startForegroundService(context, intent)
                StartRequestResult(success = true, status = "idle", message = null, errorCode = null)
            } catch (exception: ForegroundServiceStartNotAllowedException) {
                lastFailureCode = ERROR_FGS_START_BLOCKED
                lastFailureMessage =
                    exception.message ?: "Android blocked camera foreground service startup."
                StartRequestResult(
                    success = false,
                    status = "activation_blocked",
                    message = lastFailureMessage,
                    errorCode = ERROR_FGS_START_BLOCKED
                )
            } catch (exception: SecurityException) {
                lastFailureCode = ERROR_FGS_START_BLOCKED
                lastFailureMessage =
                    exception.message ?: "Android blocked camera foreground service startup."
                StartRequestResult(
                    success = false,
                    status = "activation_blocked",
                    message = lastFailureMessage,
                    errorCode = ERROR_FGS_START_BLOCKED
                )
            } catch (exception: Throwable) {
                lastFailureCode = ERROR_SIGNALING_FAILED
                lastFailureMessage = exception.message ?: "Camera service failed to start."
                StartRequestResult(
                    success = false,
                    status = "failed",
                    message = lastFailureMessage,
                    errorCode = ERROR_SIGNALING_FAILED
                )
            }
        }

        fun startSession(
            context: Context,
            cameraFacing: String = DEFAULT_CAMERA_FACING,
            includeAudio: Boolean = false,
            preferredTransport: String = DEFAULT_PREFERRED_TRANSPORT,
            cameraSessionId: String? = null,
            frameIntervalMs: Int = DEFAULT_MJPEG_FRAME_INTERVAL_MS
        ): Boolean {
            if (!running || !armed) {
                lastFailureCode = ERROR_SERVICE_NOT_ARMED
                lastFailureMessage =
                    "Camera service is not armed. Open the SafeLens app once to re-arm it."
                failureSessionId = cameraSessionId
                activeSessionId = cameraSessionId
                return false
            }

            val intent = Intent(context, CameraStreamService::class.java).apply {
                action = ACTION_START_STREAM_SESSION
                putExtra(EXTRA_CAMERA_FACING, cameraFacing)
                putExtra(EXTRA_INCLUDE_AUDIO, includeAudio)
                putExtra(EXTRA_PREFERRED_TRANSPORT, preferredTransport)
                putExtra(EXTRA_CAMERA_SESSION_ID, cameraSessionId)
                putExtra(EXTRA_FRAME_INTERVAL_MS, frameIntervalMs)
            }

            return runCatching {
                context.startService(intent)
                activeSessionId = cameraSessionId
                signalingReadySessionId = null
                failureSessionId = null
                lastFailureCode = null
                lastFailureMessage = null
                true
            }.getOrElse { throwable ->
                failureSessionId = cameraSessionId
                lastFailureCode = ERROR_SIGNALING_FAILED
                lastFailureMessage =
                    throwable.message ?: "Failed to send start-session request to camera service."
                false
            }
        }

        fun stopSession(context: Context): Boolean {
            return runCatching {
                val intent = Intent(context, CameraStreamService::class.java).apply {
                    action = ACTION_STOP_STREAM_SESSION
                }
                context.startService(intent)
                true
            }.getOrDefault(false)
        }

        fun disarm(context: Context): Boolean {
            return runCatching {
                val intent = Intent(context, CameraStreamService::class.java).apply {
                    action = ACTION_DISARM_SERVICE
                }
                context.startService(intent)
                true
            }.getOrDefault(false)
        }

        fun stop(context: Context): Boolean = stopSession(context)
        fun isServiceRunning(): Boolean = running
        fun isServiceArmed(): Boolean = running && armed

        fun getRuntimeSnapshot() =
            CameraServiceRuntimeSnapshot(
                running = running,
                armed = armed,
                activeSessionId = activeSessionId,
                signalingReadySessionId = signalingReadySessionId,
                failureSessionId = failureSessionId,
                lastErrorCode = lastFailureCode,
                lastError = lastFailureMessage
            )
    }
}

private suspend fun suspendCoroutineSdp(
    action: (SdpObserver) -> Unit
): SessionDescription = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
    action(
        object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) {
                val value = sessionDescription ?: return
                if (continuation.isActive) {
                    continuation.resume(value)
                }
            }

            override fun onSetSuccess() {}

            override fun onCreateFailure(error: String?) {
                if (continuation.isActive) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "Unable to create session description.")
                    )
                }
            }

            override fun onSetFailure(error: String?) {}
        }
    )
}

private suspend fun setRemoteDescription(
    connection: PeerConnection,
    description: SessionDescription
) {
    suspendSetDescription { observer ->
        connection.setRemoteDescription(observer, description)
    }
}

private suspend fun setLocalDescription(
    connection: PeerConnection,
    description: SessionDescription
) {
    suspendSetDescription { observer ->
        connection.setLocalDescription(observer, description)
    }
}

private suspend fun suspendSetDescription(
    action: (SdpObserver) -> Unit
) = kotlinx.coroutines.suspendCancellableCoroutine<Unit> { continuation ->
    action(
        object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) {}

            override fun onSetSuccess() {
                if (continuation.isActive) {
                    continuation.resume(Unit)
                }
            }

            override fun onCreateFailure(error: String?) {}

            override fun onSetFailure(error: String?) {
                if (continuation.isActive) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "Unable to apply session description.")
                    )
                }
            }
        }
    )
}

private class MjpegUploadSink(
    private val onFrameCallback: (VideoFrame) -> Unit
) : VideoSink {
    override fun onFrame(frame: VideoFrame?) {
        frame ?: return
        onFrameCallback(frame)
    }
}

data class StartRequestResult(
    val success: Boolean,
    val status: String,
    val message: String?,
    val errorCode: String?
)

data class CameraServiceRuntimeSnapshot(
    val running: Boolean,
    val armed: Boolean,
    val activeSessionId: String?,
    val signalingReadySessionId: String?,
    val failureSessionId: String?,
    val lastErrorCode: String?,
    val lastError: String?
)

private class CameraOpenFailureException(
    override val message: String,
    override val cause: Throwable? = null
) : IllegalStateException(message, cause)
