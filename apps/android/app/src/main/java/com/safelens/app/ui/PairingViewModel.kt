package com.safelens.app.ui

import android.app.Application

import com.safelens.app.BuildConfig
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope

import com.safelens.app.data.DeviceRepository
import com.safelens.app.data.StoredDeviceSession
import com.safelens.app.service.CameraStreamService
import com.safelens.app.service.DeviceConnectionService

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class PairingUiState(
    val apiBaseUrl: String = BuildConfig.API_BASE_URL,
    val apiBaseUrlDraft: String = BuildConfig.API_BASE_URL,
    val pairingCode: String = "",
    val isSubmitting: Boolean = false,
    val isCheckingConnectivity: Boolean = false,
    val notificationAccessEnabled: Boolean = false,
    val autoStartSetupConfirmed: Boolean = false,
    val status: String = "Ready to pair this managed device.",
    val connectivityStatus: String = "Server connectivity not checked yet.",
    val storedSession: StoredDeviceSession? = null,
    val error: String? = null
)

class PairingViewModel(
    application: Application,
    private val repository: DeviceRepository
) : AndroidViewModel(application) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mutableState = MutableStateFlow(
        PairingUiState(
            apiBaseUrl = repository.getApiBaseUrl(),
            apiBaseUrlDraft = repository.getApiBaseUrl(),
            storedSession = repository.activateStoredSessionIfPresent(),
            notificationAccessEnabled = repository.hasNotificationAccess(),
            autoStartSetupConfirmed = repository.hasAutoStartSetupConfirmed()
        ).let { initialState ->
            if (initialState.storedSession != null) {
                initialState.copy(
                    status = "Trusted device session restored on this device."
                )
            } else {
                initialState
            }
        }
    )
    val uiState: StateFlow<PairingUiState> = mutableState.asStateFlow()

    init {
        refreshStoredSession()
    }

    fun updateApiBaseUrlDraft(value: String) {
        mutableState.value = mutableState.value.copy(
            apiBaseUrlDraft = value,
            error = null
        )
    }

    fun saveApiBaseUrl() {
        runCatching { repository.saveApiBaseUrl(mutableState.value.apiBaseUrlDraft) }
            .onSuccess { savedValue ->
                mutableState.value = mutableState.value.copy(
                    apiBaseUrl = savedValue,
                    apiBaseUrlDraft = savedValue,
                    status = "Server URL saved. Future connectivity and pairing calls will use it.",
                    error = null
                )
            }
            .onFailure { throwable ->
                mutableState.value = mutableState.value.copy(
                    error = throwable.message ?: "Could not save the server URL."
                )
            }
    }

    fun updatePairingCode(value: String) {
        mutableState.value = mutableState.value.copy(
            pairingCode = value.uppercase().take(6),
            error = null
        )
    }

    fun applyScannedPairingPayload(rawValue: String) {
        val parsedPayload = parseQrPayload(rawValue.trim())

        if (parsedPayload == null) {
            mutableState.value = mutableState.value.copy(
                error = "That QR code is not a valid SafeLens pairing code."
            )
            return
        }

        if (parsedPayload.apiBaseUrl != null) {
            runCatching { repository.saveApiBaseUrl(parsedPayload.apiBaseUrl) }
                .onSuccess { savedValue ->
                    mutableState.value = mutableState.value.copy(
                        apiBaseUrl = savedValue,
                        apiBaseUrlDraft = savedValue
                    )
                }
                .onFailure { throwable ->
                    mutableState.value = mutableState.value.copy(
                        error = throwable.message ?: "Could not save the server URL from QR."
                    )
                    return
                }
        }

        mutableState.value = mutableState.value.copy(
            pairingCode = parsedPayload.code,
            status = "Pairing code loaded from QR scan.",
            error = null
        )
        pairDevice()
    }

    fun pairDevice() {
        val code = mutableState.value.pairingCode
        if (code.length != 6) {
            mutableState.value = mutableState.value.copy(
                error = "Enter the six-letter pairing code from the SafeLens dashboard."
            )
            return
        }

        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(
                isSubmitting = true,
                status = "Pairing device with workspace...",
                error = null
            )

            runCatching { repository.pair(code) }
                .onSuccess { session ->
                    DeviceConnectionService.start(getApplication())
                    if (repository.hasCameraPermission()) {
                        CameraStreamService.arm(getApplication())
                    }
                    mutableState.value = mutableState.value.copy(
                        isSubmitting = false,
                        storedSession = session,
                        status = "Device paired successfully. Trusted session stored.",
                        error = null
                    )
                }
                .onFailure { throwable ->
                    mutableState.value = mutableState.value.copy(
                        isSubmitting = false,
                        status = "Pairing failed.",
                        error = throwable.message ?: "Unexpected pairing failure."
                    )
                }
        }
    }

    fun testConnectivity() {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(
                isCheckingConnectivity = true,
                connectivityStatus = "Checking SafeLens API connectivity...",
                error = null
            )

            runCatching { repository.testConnectivity() }
                .onSuccess { health ->
                    mutableState.value = mutableState.value.copy(
                        isCheckingConnectivity = false,
                        connectivityStatus = "Connected to ${health.service} at ${health.timestamp}.",
                        error = null
                    )
                    refreshStoredSession()
                }
                .onFailure { throwable ->
                    mutableState.value = mutableState.value.copy(
                        isCheckingConnectivity = false,
                        connectivityStatus = "Server connectivity failed.",
                        error = throwable.message ?: "Unable to reach the SafeLens API."
                    )
                }
        }
    }

    fun clearPairing() {
        viewModelScope.launch {
            repository.unpairStoredSession()
            DeviceConnectionService.stop(getApplication())
            CameraStreamService.disarm(getApplication())
            mutableState.value = mutableState.value.copy(
                storedSession = null,
                status = "Trusted device session cleared. Ready to pair again.",
                error = null
            )
        }
    }

    fun refreshStoredSession() {
        viewModelScope.launch {
            val previousSession = mutableState.value.storedSession
            val storedSession = repository.syncStoredSession()
            if (storedSession != null) {
                DeviceConnectionService.start(getApplication())
                if (repository.hasCameraPermission()) {
                    CameraStreamService.arm(getApplication())
                }
            } else {
                DeviceConnectionService.stop(getApplication())
                CameraStreamService.disarm(getApplication())
            }
            mutableState.value = mutableState.value.copy(
                notificationAccessEnabled = repository.hasNotificationAccess(),
                autoStartSetupConfirmed = repository.hasAutoStartSetupConfirmed(),
                storedSession = storedSession,
                status =
                    if (storedSession != null) {
                        "Trusted device session restored on this device."
                    } else if (previousSession != null) {
                        "Trusted device session is no longer active on this device."
                    } else {
                        "No trusted session is currently active for this device."
                    }
            )
        }
    }

    fun markNotificationAccessEnabled() {
        mutableState.value = mutableState.value.copy(
            notificationAccessEnabled = true,
            status = "Notification access enabled. SafeLens can now capture app notifications."
        )
    }

    fun hasShownNotificationAccessPrompt(): Boolean {
        return repository.hasShownNotificationAccessPrompt()
    }

    fun markNotificationAccessPromptShown() {
        repository.markNotificationAccessPromptShown()
    }

    fun markAutoStartSetupConfirmed() {
        repository.markAutoStartSetupConfirmed(true)
        mutableState.value = mutableState.value.copy(
            autoStartSetupConfirmed = true,
            status = "Background auto start setup confirmed for this device."
        )
    }

    private fun parseQrPayload(rawValue: String): QrPairingPayload? {
        val directCode = rawValue.uppercase()
        if (directCode.matches(Regex("^[A-Z]{6}$"))) {
            return QrPairingPayload(code = directCode, apiBaseUrl = null)
        }

        return runCatching {
            val payload = json.parseToJsonElement(rawValue).jsonObject
            val code = payload["code"]?.jsonPrimitive?.content?.trim()?.uppercase()
            val type = payload["type"]?.jsonPrimitive?.content
            val apiBaseUrl = payload["apiBaseUrl"]?.jsonPrimitive?.content?.trim()

            if (
                type != "safelens-pairing" ||
                code == null ||
                !code.matches(Regex("^[A-Z]{6}$"))
            ) {
                null
            } else {
                QrPairingPayload(code = code, apiBaseUrl = apiBaseUrl)
            }
        }.getOrNull()
    }
}

private data class QrPairingPayload(
    val code: String,
    val apiBaseUrl: String?
)

class PairingViewModelFactory(
    private val application: Application,
    private val repository: DeviceRepository
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return PairingViewModel(application, repository) as T
    }
}
