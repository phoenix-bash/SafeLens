package com.safelens.app.sync

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "telemetry_snapshots")
data class TelemetrySnapshotEntity(
    @PrimaryKey
    @ColumnInfo(name = "client_id")
    val clientId: String,
    val kind: String,
    @ColumnInfo(name = "collected_at")
    val collectedAt: String,
    @ColumnInfo(name = "payload_json")
    val payloadJson: String,
    @ColumnInfo(name = "synced_at")
    val syncedAt: String? = null
)
