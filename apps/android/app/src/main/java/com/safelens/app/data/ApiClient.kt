package com.safelens.app.data

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ApiException(
    val statusCode: Int,
    message: String
) : IllegalStateException(message)

class ApiClient(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    fun healthCheck(apiBaseUrl: String): HealthStatusDto {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/health")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Health check failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(HealthStatusDto.serializer(), rawBody)
        }
    }

    fun pairDevice(apiBaseUrl: String, payload: PairDeviceRequestDto): PairDeviceResponseDto {
        val requestBody = json.encodeToString(PairDeviceRequestDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/pair")
            .post(requestBody)
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Pairing failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(PairDeviceResponseDto.serializer(), rawBody)
        }
    }

    fun getDeviceSessionStatus(
        apiBaseUrl: String,
        deviceToken: String
    ): DeviceSessionStatusDto {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/session")
            .get()
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Session status failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(DeviceSessionStatusDto.serializer(), rawBody)
        }
    }

    fun getPendingDeviceCommands(
        apiBaseUrl: String,
        deviceToken: String
    ): PendingDeviceCommandsResponseDto {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/commands")
            .get()
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Pending commands failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(PendingDeviceCommandsResponseDto.serializer(), rawBody)
        }
    }

    fun acknowledgeDeviceCommand(
        apiBaseUrl: String,
        deviceToken: String,
        commandId: String,
        payload: DeviceCommandAckRequestDto
    ): DeviceCommandDto {
        val requestBody = json.encodeToString(DeviceCommandAckRequestDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/commands/$commandId/ack")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Device command acknowledgement failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(DeviceCommandDto.serializer(), rawBody)
        }
    }

    fun uploadTelemetryBatch(
        apiBaseUrl: String,
        deviceToken: String,
        payload: TelemetryBatchIngestRequestDto
    ) {
        val requestBody = json.encodeToString(TelemetryBatchIngestRequestDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/telemetry/batches")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Telemetry upload failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun uploadNotificationBatch(
        apiBaseUrl: String,
        deviceToken: String,
        payload: NotificationBatchIngestRequestDto
    ) {
        val requestBody = json.encodeToString(NotificationBatchIngestRequestDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/notifications/batches")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Notification upload failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun uploadCallLogBatch(
        apiBaseUrl: String,
        deviceToken: String,
        payload: CallLogBatchIngestRequestDto
    ) {
        val requestBody = json.encodeToString(CallLogBatchIngestRequestDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/call-logs/batches")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Call log upload failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun uploadCameraStreamFrame(
        apiBaseUrl: String,
        deviceToken: String,
        payload: CameraStreamFrameUploadDto
    ) {
        val requestBody = json.encodeToString(CameraStreamFrameUploadDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self-camera-stream/frame")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Camera stream frame upload failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun uploadCameraStreamAudioChunk(
        apiBaseUrl: String,
        deviceToken: String,
        payload: CameraStreamAudioChunkUploadDto
    ) {
        val requestBody =
            json.encodeToString(CameraStreamAudioChunkUploadDto.serializer(), payload)
                .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self-camera-stream/audio-chunk")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Camera stream audio upload failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun updateCameraStreamState(
        apiBaseUrl: String,
        deviceToken: String,
        payload: CameraStreamDeviceStateUpdateDto
    ) {
        val requestBody =
            json.encodeToString(CameraStreamDeviceStateUpdateDto.serializer(), payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self-camera-stream/state")
            .post(requestBody)
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Camera stream state update failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun getSelfCameraStreamSession(
        apiBaseUrl: String,
        deviceToken: String
    ): CameraStreamSessionStateDto {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self-camera-stream/session")
            .get()
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Camera session read failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(CameraStreamSessionStateDto.serializer(), rawBody)
        }
    }

    fun unpairSelf(apiBaseUrl: String, deviceToken: String) {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/session")
            .delete()
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Self unpair failed with status ${response.code}: $rawBody"
                )
            }
        }
    }

    fun heartbeatSelf(
        apiBaseUrl: String,
        deviceToken: String
    ): DeviceSessionStatusDto {
        val request = Request.Builder()
            .url("${apiBaseUrl.trimEnd('/')}/devices/self/heartbeat")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $deviceToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(
                    response.code,
                    "Heartbeat failed with status ${response.code}: $rawBody"
                )
            }
            return json.decodeFromString(DeviceSessionStatusDto.serializer(), rawBody)
        }
    }
}
