package com.safelens.app.sync

import android.content.Context

import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        TelemetrySnapshotEntity::class,
        DeviceCommandEntity::class,
        SyncSettingEntity::class,
        NotificationRecordEntity::class,
        CallLogRecordEntity::class
    ],
    version = 3,
    exportSchema = false
)
abstract class SyncDatabase : RoomDatabase() {
    abstract fun telemetrySnapshotDao(): TelemetrySnapshotDao
    abstract fun deviceCommandDao(): DeviceCommandDao
    abstract fun syncSettingDao(): SyncSettingDao
    abstract fun notificationRecordDao(): NotificationRecordDao
    abstract fun callLogRecordDao(): CallLogRecordDao

    companion object {
        @Volatile
        private var instance: SyncDatabase? = null

        fun getInstance(context: Context): SyncDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    SyncDatabase::class.java,
                    "safelens-sync.db"
                )
                    .fallbackToDestructiveMigration()
                    .build().also { database ->
                    instance = database
                }
            }
        }
    }
}
