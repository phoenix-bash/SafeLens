package com.safelens.app.sync

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface TelemetrySnapshotDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(snapshot: TelemetrySnapshotEntity)

    @Query(
        """
        SELECT * FROM telemetry_snapshots
        WHERE synced_at IS NULL
        ORDER BY collected_at ASC
        LIMIT :limit
        """
    )
    suspend fun getPending(limit: Int): List<TelemetrySnapshotEntity>

    @Query("UPDATE telemetry_snapshots SET synced_at = :syncedAt WHERE client_id IN (:clientIds)")
    suspend fun markSynced(clientIds: List<String>, syncedAt: String)

    @Query(
        """
        SELECT * FROM telemetry_snapshots
        WHERE kind = :kind
        ORDER BY collected_at DESC
        LIMIT 1
        """
    )
    suspend fun getLatestForKind(kind: String): TelemetrySnapshotEntity?
}

@Dao
interface DeviceCommandDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(command: DeviceCommandEntity)

    @Query("SELECT * FROM device_commands WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): DeviceCommandEntity?
}

@Dao
interface SyncSettingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(setting: SyncSettingEntity)

    @Query("SELECT * FROM sync_settings WHERE key = :key LIMIT 1")
    suspend fun getByKey(key: String): SyncSettingEntity?
}

@Dao
interface NotificationRecordDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: NotificationRecordEntity)

    @Query(
        """
        SELECT * FROM notification_records
        WHERE synced_at IS NULL
        ORDER BY posted_at ASC
        LIMIT :limit
        """
    )
    suspend fun getPending(limit: Int): List<NotificationRecordEntity>

    @Query("UPDATE notification_records SET synced_at = :syncedAt WHERE client_id IN (:clientIds)")
    suspend fun markSynced(clientIds: List<String>, syncedAt: String)

    @Query("DELETE FROM notification_records WHERE synced_at IS NOT NULL")
    suspend fun deleteSynced()
}

@Dao
interface CallLogRecordDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: CallLogRecordEntity)

    @Query(
        """
        SELECT * FROM call_log_records
        WHERE synced_at IS NULL
        ORDER BY occurred_at ASC
        LIMIT :limit
        """
    )
    suspend fun getPending(limit: Int): List<CallLogRecordEntity>

    @Query("UPDATE call_log_records SET synced_at = :syncedAt WHERE client_id IN (:clientIds)")
    suspend fun markSynced(clientIds: List<String>, syncedAt: String)

    @Query("DELETE FROM call_log_records WHERE synced_at IS NOT NULL")
    suspend fun deleteSynced()
}
