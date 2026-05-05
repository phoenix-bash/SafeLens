package com.safelens.app.sync

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "notification_records",
    indices = [
        Index(value = ["fingerprint"], unique = true),
        Index(value = ["synced_at", "posted_at"])
    ]
)
data class NotificationRecordEntity(
    @PrimaryKey
    @ColumnInfo(name = "client_id")
    val clientId: String,
    val fingerprint: String,
    @ColumnInfo(name = "package_name")
    val packageName: String,
    @ColumnInfo(name = "app_label")
    val appLabel: String,
    val title: String,
    val text: String,
    @ColumnInfo(name = "posted_at")
    val postedAt: String,
    @ColumnInfo(name = "payload_json")
    val payloadJson: String,
    @ColumnInfo(name = "synced_at")
    val syncedAt: String? = null
)
