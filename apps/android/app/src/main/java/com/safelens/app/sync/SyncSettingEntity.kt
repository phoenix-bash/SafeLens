package com.safelens.app.sync

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sync_settings")
data class SyncSettingEntity(
    @PrimaryKey
    val key: String,
    @ColumnInfo(name = "string_value")
    val value: String
)
