package com.safelens.app.device

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.os.StatFs
import android.hardware.SensorManager

import java.security.MessageDigest

data class DeviceMetadata(
    val deviceName: String,
    val model: String,
    val manufacturer: String,
    val androidVersion: String,
    val deviceFingerprint: String
)

data class DetailedDeviceInfo(
    val deviceName: String,
    val model: String,
    val manufacturer: String,
    val androidVersion: String,
    val buildId: String,
    val fingerprint: String,
    val totalRamBytes: Long,
    val availableStorageBytes: Long,
    val totalStorageBytes: Long,
    val sensors: List<String>,
    val batteryOptimizationIgnored: Boolean
)

class DeviceMetadataCollector(private val application: Application) {
    fun collect(): DeviceMetadata {
        val fingerprint = resolveFingerprint()
        val appName = application.applicationInfo.loadLabel(application.packageManager).toString()

        return DeviceMetadata(
            deviceName = "$appName on ${Build.MODEL}",
            model = Build.MODEL ?: "Unknown model",
            manufacturer = Build.MANUFACTURER ?: "Unknown manufacturer",
            androidVersion = Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(),
            deviceFingerprint = fingerprint
        )
    }

    fun collectDetailedInfo(): DetailedDeviceInfo {
        val basicMetadata = collect()
        val activityManager = application.getSystemService(ActivityManager::class.java)
        val sensorManager = application.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val powerManager = application.getSystemService(PowerManager::class.java)
        val memoryInfo = ActivityManager.MemoryInfo().also { info ->
            activityManager?.getMemoryInfo(info)
        }
        val statFs = StatFs(application.filesDir.absolutePath)

        return DetailedDeviceInfo(
            deviceName = basicMetadata.deviceName,
            model = basicMetadata.model,
            manufacturer = basicMetadata.manufacturer,
            androidVersion = basicMetadata.androidVersion,
            buildId = Build.DISPLAY ?: Build.ID ?: "unknown-build",
            fingerprint = basicMetadata.deviceFingerprint,
            totalRamBytes = memoryInfo.totalMem,
            availableStorageBytes = statFs.availableBytes,
            totalStorageBytes = statFs.totalBytes,
            sensors = sensorManager.getSensorList(android.hardware.Sensor.TYPE_ALL)
                .mapNotNull { it.name?.trim() }
                .distinct()
                .sorted(),
            batteryOptimizationIgnored =
                powerManager?.isIgnoringBatteryOptimizations(application.packageName) == true
        )
    }

    private fun resolveFingerprint(): String {
        val androidId = Settings.Secure.getString(
            application.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown-android-id"
        val fingerprintSource = listOf(
            androidId,
            Build.BRAND ?: "unknown-brand",
            Build.DEVICE ?: "unknown-device",
            Build.MODEL ?: "unknown-model",
            Build.ID ?: "unknown-build-id",
            Build.DISPLAY ?: "unknown-build-display",
            Build.VERSION.INCREMENTAL ?: "unknown-build-incremental",
            application.packageName
        ).joinToString(separator = "|")

        return fingerprintSource.sha256()
    }

    private fun String.sha256(): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(toByteArray()).joinToString(separator = "") { byte ->
            "%02x".format(byte)
        }
    }
}
