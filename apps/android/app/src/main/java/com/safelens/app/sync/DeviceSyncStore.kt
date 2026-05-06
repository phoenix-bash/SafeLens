package com.safelens.app.sync

import android.app.Application

import com.safelens.app.data.DeviceCommandDto
import com.safelens.app.data.CallLogRecordDto
import com.safelens.app.data.NotificationRecordDto
import com.safelens.app.data.TelemetrySnapshotDto

import kotlinx.serialization.json.Json

class DeviceSyncStore(application: Application) {
    private val json = Json { ignoreUnknownKeys = true }
    private val database = SyncDatabase.getInstance(application)

    suspend fun enqueueTelemetry(snapshot: TelemetrySnapshotDto, bypassDedup: Boolean = false) {
        val latest = if (bypassDedup) null else database.telemetrySnapshotDao().getLatestForKind(snapshot.kind)
        val payloadJson = json.encodeToString(TelemetrySnapshotDto.serializer(), snapshot)

        if (latest != null) {
            val latestSnapshot = json.decodeFromString(
                TelemetrySnapshotDto.serializer(),
                latest.payloadJson
            )
            if (latestSnapshot.payload == snapshot.payload) {
                return
            }
        }

        database.telemetrySnapshotDao().insert(
            TelemetrySnapshotEntity(
                clientId = snapshot.clientId,
                kind = snapshot.kind,
                collectedAt = snapshot.collectedAt,
                payloadJson = payloadJson
            )
        )
    }

    suspend fun getPendingTelemetry(limit: Int): List<TelemetrySnapshotDto> {
        return database.telemetrySnapshotDao().getPending(limit).map { entity ->
            json.decodeFromString(TelemetrySnapshotDto.serializer(), entity.payloadJson)
        }
    }

    suspend fun markTelemetrySynced(clientIds: List<String>, syncedAt: String) {
        if (clientIds.isEmpty()) {
            return
        }
        database.telemetrySnapshotDao().markSynced(clientIds, syncedAt)
    }

    suspend fun upsertCommand(command: DeviceCommandDto) {
        database.deviceCommandDao().upsert(
            DeviceCommandEntity(
                id = command.id,
                type = command.type,
                status = command.status,
                payloadJson = json.encodeToString(DeviceCommandDto.serializer(), command),
                receivedAt = command.createdAt,
                updatedAt = command.completedAt ?: command.acknowledgedAt ?: command.createdAt,
                lastError = command.lastError
            )
        )
    }

    suspend fun getCommand(commandId: String): DeviceCommandDto? {
        val entity = database.deviceCommandDao().getById(commandId) ?: return null
        return json.decodeFromString(DeviceCommandDto.serializer(), entity.payloadJson)
    }

    suspend fun enqueueNotification(record: NotificationRecordDto) {
        database.notificationRecordDao().insert(
            NotificationRecordEntity(
                clientId = record.clientId,
                fingerprint = record.fingerprint,
                packageName = record.packageName,
                appLabel = record.appLabel,
                title = record.title,
                text = record.text,
                postedAt = record.postedAt,
                payloadJson = json.encodeToString(NotificationRecordDto.serializer(), record)
            )
        )
    }

    suspend fun getPendingNotifications(limit: Int): List<NotificationRecordDto> {
        return database.notificationRecordDao().getPending(limit).map { entity ->
            json.decodeFromString(NotificationRecordDto.serializer(), entity.payloadJson)
        }
    }

    suspend fun markNotificationsSynced(clientIds: List<String>, syncedAt: String) {
        if (clientIds.isEmpty()) {
            return
        }
        database.notificationRecordDao().markSynced(clientIds, syncedAt)
    }

    suspend fun enqueueCallLog(record: CallLogRecordDto) {
        database.callLogRecordDao().insert(
            CallLogRecordEntity(
                clientId = record.clientId,
                fingerprint = record.fingerprint,
                contactName = record.contactName,
                phoneNumber = record.phoneNumber,
                callType = record.callType,
                durationSeconds = record.durationSeconds,
                occurredAt = record.occurredAt,
                payloadJson = json.encodeToString(CallLogRecordDto.serializer(), record)
            )
        )
    }

    suspend fun getPendingCallLogs(limit: Int): List<CallLogRecordDto> {
        return database.callLogRecordDao().getPending(limit).map { entity ->
            json.decodeFromString(CallLogRecordDto.serializer(), entity.payloadJson)
        }
    }

    suspend fun markCallLogsSynced(clientIds: List<String>, syncedAt: String) {
        if (clientIds.isEmpty()) {
            return
        }
        database.callLogRecordDao().markSynced(clientIds, syncedAt)
        database.callLogRecordDao().deleteSynced()
    }

    suspend fun setBoolean(key: String, value: Boolean) {
        database.syncSettingDao().upsert(SyncSettingEntity(key = key, value = value.toString()))
    }

    suspend fun getBoolean(key: String, fallback: Boolean): Boolean {
        return database.syncSettingDao().getByKey(key)?.value?.toBooleanStrictOrNull() ?: fallback
    }

    suspend fun setInt(key: String, value: Int) {
        database.syncSettingDao().upsert(SyncSettingEntity(key = key, value = value.toString()))
    }

    suspend fun getInt(key: String, fallback: Int): Int {
        return database.syncSettingDao().getByKey(key)?.value?.toIntOrNull() ?: fallback
    }

    companion object {
        const val KEY_LOCATION_REPORTING_ENABLED = "location_reporting_enabled"
        const val KEY_LOCATION_INTERVAL_MINUTES = "location_interval_minutes"
        const val DEFAULT_LOCATION_INTERVAL_MINUTES = 10
    }
}
