package com.safelens.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class DeviceCapabilityDto(
    val key: String,
    val label: String,
    val status: String
)

@Serializable
data class PairDeviceRequestDto(
    val code: String,
    @SerialName("deviceName") val deviceName: String,
    val model: String,
    val manufacturer: String,
    @SerialName("androidVersion") val androidVersion: String,
    @SerialName("deviceFingerprint") val deviceFingerprint: String,
    val capabilities: List<DeviceCapabilityDto>
)

@Serializable
data class PairDeviceResponseDto(
    @SerialName("deviceId") val deviceId: String,
    @SerialName("deviceToken") val deviceToken: String,
    @SerialName("workspaceId") val workspaceId: String,
    @SerialName("pairedAt") val pairedAt: String
)

@Serializable
data class HealthStatusDto(
    val status: String,
    val service: String,
    val timestamp: String
)

@Serializable
data class DeviceSessionStatusDto(
    val id: String,
    @SerialName("workspaceId") val workspaceId: String,
    val name: String,
    val model: String,
    val manufacturer: String,
    @SerialName("androidVersion") val androidVersion: String,
    @SerialName("isOnline") val isOnline: Boolean,
    @SerialName("pairedAt") val pairedAt: String,
    @SerialName("lastSeenAt") val lastSeenAt: String
)

@Serializable
data class DeviceCommandDto(
    val id: String,
    @SerialName("workspaceId") val workspaceId: String,
    @SerialName("deviceId") val deviceId: String,
    val type: String,
    val status: String,
    val payload: DeviceCommandPayloadDto = DeviceCommandPayloadDto(),
    @SerialName("createdAt") val createdAt: String,
    @SerialName("acknowledgedAt") val acknowledgedAt: String? = null,
    @SerialName("completedAt") val completedAt: String? = null,
    @SerialName("lastError") val lastError: String? = null
)

@Serializable
data class DeviceCommandPayloadDto(
    val reason: String? = null,
    @SerialName("intervalMinutes") val intervalMinutes: Int? = null,
    @SerialName("frameIntervalMs") val frameIntervalMs: Int? = null,
    @SerialName("cameraFacing") val cameraFacing: String? = null,
    @SerialName("includeAudio") val includeAudio: Boolean? = null,
    @SerialName("preferredTransport") val preferredTransport: String? = null,
    @SerialName("cameraSessionId") val cameraSessionId: String? = null,
    @SerialName("recordingsOffset") val recordingsOffset: Int? = null,
    @SerialName("recordingsLimit") val recordingsLimit: Int? = null,
    @SerialName("xiaomiCallRecordingPaths")
    val xiaomiCallRecordingPaths: List<String>? = null,
    @SerialName("vivoCallRecordingPaths")
    val vivoCallRecordingPaths: List<String>? = null
)

@Serializable
data class DeviceCommandAckRequestDto(
    val status: String,
    @SerialName("lastError") val lastError: String? = null
)

@Serializable
data class PendingDeviceCommandsResponseDto(
    val commands: List<DeviceCommandDto>
)

@Serializable
data class TelemetryBatchIngestRequestDto(
    val snapshots: List<TelemetrySnapshotDto>
)

@Serializable
data class TelemetrySnapshotDto(
    @SerialName("clientId") val clientId: String,
    val kind: String,
    @SerialName("collectedAt") val collectedAt: String,
    val payload: TelemetrySnapshotPayloadDto
)

@Serializable
data class TelemetrySnapshotPayloadDto(
    @SerialName("deviceInfo") val deviceInfo: DeviceInfoSnapshotDto? = null,
    val battery: BatterySnapshotDto? = null,
    val location: LocationSnapshotDto? = null
)

@Serializable
data class DeviceInfoSnapshotDto(
    @SerialName("deviceName") val deviceName: String,
    val model: String,
    val manufacturer: String,
    @SerialName("androidVersion") val androidVersion: String,
    @SerialName("buildId") val buildId: String,
    val fingerprint: String,
    @SerialName("totalRamBytes") val totalRamBytes: Long,
    @SerialName("availableStorageBytes") val availableStorageBytes: Long,
    @SerialName("totalStorageBytes") val totalStorageBytes: Long,
    val sensors: List<String>,
    @SerialName("batteryOptimizationIgnored") val batteryOptimizationIgnored: Boolean
)

@Serializable
data class BatterySnapshotDto(
    @SerialName("levelPercent") val levelPercent: Int,
    @SerialName("isCharging") val isCharging: Boolean,
    @SerialName("statusLabel") val statusLabel: String
)

@Serializable
data class LocationSnapshotDto(
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerialName("accuracyMeters") val accuracyMeters: Float? = null,
    val provider: String,
    @SerialName("isEnabled") val isEnabled: Boolean? = null,
    @SerialName("statusLabel") val statusLabel: String? = null
)

@Serializable
data class NotificationRecordDto(
    @SerialName("clientId") val clientId: String,
    val fingerprint: String,
    @SerialName("packageName") val packageName: String,
    @SerialName("appLabel") val appLabel: String,
    val title: String,
    val text: String,
    @SerialName("postedAt") val postedAt: String
)

@Serializable
data class NotificationBatchIngestRequestDto(
    val notifications: List<NotificationRecordDto>
)

@Serializable
data class CallLogRecordDto(
    @SerialName("clientId") val clientId: String,
    val fingerprint: String,
    @SerialName("contactName") val contactName: String? = null,
    @SerialName("phoneNumber") val phoneNumber: String,
    @SerialName("callType") val callType: String,
    @SerialName("durationSeconds") val durationSeconds: Int,
    @SerialName("occurredAt") val occurredAt: String
)

@Serializable
data class CallLogBatchIngestRequestDto(
    @SerialName("callLogs") val callLogs: List<CallLogRecordDto>
)

@Serializable
data class CallRecordingRecordDto(
    @SerialName("clientId") val clientId: String,
    val fingerprint: String,
    val source: String,
    @SerialName("fileName") val fileName: String,
    @SerialName("mimeType") val mimeType: String,
    val extension: String,
    @SerialName("byteSize") val byteSize: Int,
    @SerialName("relativePath") val relativePath: String,
    @SerialName("capturedAt") val capturedAt: String,
    @SerialName("contentBase64") val contentBase64: String
)

@Serializable
data class CallRecordingBatchIngestRequestDto(
    val recordings: List<CallRecordingRecordDto>
)

@Serializable
data class CameraIceServerDto(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null
)

@Serializable
data class CameraStreamViewerDto(
    @SerialName("viewerId") val viewerId: String,
    val transport: String? = null,
    @SerialName("joinedAt") val joinedAt: String
)

@Serializable
data class CameraStreamSessionStateDto(
    @SerialName("sessionId") val sessionId: String? = null,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("workspaceId") val workspaceId: String,
    val status: String,
    @SerialName("cameraFacing") val cameraFacing: String,
    @SerialName("includeAudio") val includeAudio: Boolean,
    @SerialName("audioAvailable") val audioAvailable: Boolean,
    @SerialName("signalingReady") val signalingReady: Boolean,
    @SerialName("preferredTransport") val preferredTransport: String,
    @SerialName("activeTransport") val activeTransport: String? = null,
    @SerialName("viewerCount") val viewerCount: Int,
    val viewers: List<CameraStreamViewerDto>,
    @SerialName("iceServers") val iceServers: List<CameraIceServerDto>,
    @SerialName("lastFrameAt") val lastFrameAt: String? = null,
    @SerialName("lastFrameBase64") val lastFrameBase64: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    @SerialName("lastErrorCode") val lastErrorCode: String? = null,
    @SerialName("lastError") val lastError: String? = null,
    @SerialName("startedAt") val startedAt: String? = null,
    @SerialName("updatedAt") val updatedAt: String
)

@Serializable
data class CameraStreamFrameUploadDto(
    @SerialName("capturedAt") val capturedAt: String,
    @SerialName("imageBase64") val imageBase64: String,
    val width: Int,
    val height: Int,
    @SerialName("cameraFacing") val cameraFacing: String
)

@Serializable
data class CameraStreamAudioChunkUploadDto(
    @SerialName("capturedAt") val capturedAt: String,
    val sequence: Int,
    @SerialName("sampleRateHz") val sampleRateHz: Int,
    val channels: Int,
    @SerialName("bitsPerSample") val bitsPerSample: Int,
    @SerialName("pcm16Base64") val pcm16Base64: String,
    @SerialName("cameraSessionId") val cameraSessionId: String? = null
)

@Serializable
data class CameraStreamDeviceStateUpdateDto(
    val status: String,
    @SerialName("cameraFacing") val cameraFacing: String? = null,
    @SerialName("includeAudio") val includeAudio: Boolean? = null,
    @SerialName("audioAvailable") val audioAvailable: Boolean? = null,
    @SerialName("signalingReady") val signalingReady: Boolean? = null,
    @SerialName("preferredTransport") val preferredTransport: String? = null,
    @SerialName("cameraSessionId") val cameraSessionId: String? = null,
    @SerialName("lastErrorCode") val lastErrorCode: String? = null,
    @SerialName("lastError") val lastError: String? = null
)

@Serializable
data class CallLogPageItemDto(
    val id: String,
    @SerialName("clientId") val clientId: String,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("workspaceId") val workspaceId: String,
    val fingerprint: String,
    @SerialName("contactName") val contactName: String? = null,
    @SerialName("phoneNumber") val phoneNumber: String,
    @SerialName("callType") val callType: String,
    @SerialName("durationSeconds") val durationSeconds: Int,
    @SerialName("occurredAt") val occurredAt: String,
    @SerialName("createdAt") val createdAt: String
)

@Serializable
data class CallLogsPageDto(
    val items: List<CallLogPageItemDto>,
    @SerialName("nextCursor") val nextCursor: String? = null
)

@Serializable
data class NotificationAppGroupDto(
    @SerialName("appLabel") val appLabel: String,
    val count: Int
)

@Serializable
data class NotificationPageItemDto(
    val id: String,
    @SerialName("clientId") val clientId: String,
    @SerialName("deviceId") val deviceId: String,
    @SerialName("workspaceId") val workspaceId: String,
    @SerialName("packageName") val packageName: String,
    @SerialName("appLabel") val appLabel: String,
    val title: String,
    val text: String,
    @SerialName("postedAt") val postedAt: String,
    @SerialName("createdAt") val createdAt: String
)

@Serializable
data class NotificationsPageDto(
    val items: List<NotificationPageItemDto>,
    @SerialName("nextCursor") val nextCursor: String? = null,
    @SerialName("appGroups") val appGroups: List<NotificationAppGroupDto> = emptyList()
)

data class StoredDeviceSession(
    val deviceId: String,
    val deviceToken: String,
    val workspaceId: String,
    val pairedAt: String
)
