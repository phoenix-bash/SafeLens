package com.safelens.app.data

import android.content.Context
import android.content.SharedPreferences

class SecureSessionStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("safelens-session", Context.MODE_PRIVATE)

    fun save(session: StoredDeviceSession) {
        prefs.edit()
            .putString("device_id", session.deviceId)
            .putString("device_token", session.deviceToken)
            .putString("workspace_id", session.workspaceId)
            .putString("paired_at", session.pairedAt)
            .commit()
    }

    fun read(): StoredDeviceSession? {
        val deviceId = prefs.getString("device_id", null) ?: return null
        val deviceToken = prefs.getString("device_token", null) ?: return null
        val workspaceId = prefs.getString("workspace_id", null) ?: return null
        val pairedAt = prefs.getString("paired_at", null) ?: return null
        return StoredDeviceSession(
            deviceId = deviceId,
            deviceToken = deviceToken,
            workspaceId = workspaceId,
            pairedAt = pairedAt
        )
    }

    fun saveApiBaseUrl(apiBaseUrl: String) {
        prefs.edit()
            .putString("api_base_url", apiBaseUrl)
            .commit()
    }

    fun readApiBaseUrl(defaultValue: String): String {
        return prefs.getString("api_base_url", defaultValue) ?: defaultValue
    }

    fun saveNotificationAccessPromptShown(value: Boolean) {
        prefs.edit().putBoolean("notification_access_prompt_shown", value).commit()
    }

    fun readNotificationAccessPromptShown(): Boolean {
        return prefs.getBoolean("notification_access_prompt_shown", false)
    }

    fun saveAutoStartSetupConfirmed(value: Boolean) {
        prefs.edit().putBoolean("auto_start_setup_confirmed", value).commit()
    }

    fun readAutoStartSetupConfirmed(): Boolean {
        return prefs.getBoolean("auto_start_setup_confirmed", false)
    }

    fun clear() {
        prefs.edit().clear().commit()
    }

    fun clearStoredSession() {
        prefs.edit()
            .remove("device_id")
            .remove("device_token")
            .remove("workspace_id")
            .remove("paired_at")
            .commit()
    }
}
