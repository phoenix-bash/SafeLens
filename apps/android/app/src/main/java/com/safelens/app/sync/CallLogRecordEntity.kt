package com.safelens.app.sync

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "call_log_records",
    indices = [
        Index(value = ["fingerprint"], unique = true),
        Index(value = ["synced_at", "occurred_at"])
    ]
)
data class CallLogRecordEntity(
    @PrimaryKey
    @ColumnInfo(name = "client_id")
    val clientId: String,
    val fingerprint: String,
    @ColumnInfo(name = "contact_name")
    val contactName: String?,
    @ColumnInfo(name = "phone_number")
    val phoneNumber: String,
    @ColumnInfo(name = "call_type")
    val callType: String,
    @ColumnInfo(name = "duration_seconds")
    val durationSeconds: Int,
    @ColumnInfo(name = "occurred_at")
    val occurredAt: String,
    @ColumnInfo(name = "payload_json")
    val payloadJson: String,
    @ColumnInfo(name = "synced_at")
    val syncedAt: String? = null
)
