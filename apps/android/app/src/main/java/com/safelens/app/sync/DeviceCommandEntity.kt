package com.safelens.app.sync

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "device_commands")
data class DeviceCommandEntity(
    @PrimaryKey
    val id: String,
    val type: String,
    val status: String,
    @ColumnInfo(name = "payload_json")
    val payloadJson: String,
    @ColumnInfo(name = "received_at")
    val receivedAt: String,
    @ColumnInfo(name = "updated_at")
    val updatedAt: String,
    @ColumnInfo(name = "last_error")
    val lastError: String? = null
)
