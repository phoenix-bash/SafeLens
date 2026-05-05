package com.safelens.app.ui

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

import com.google.zxing.client.android.Intents

import com.safelens.app.service.CameraStreamService
import com.safelens.app.service.NotificationCaptureService
import com.safelens.app.ui.scan.ScanQrActivity
import kotlinx.coroutines.delay

@Composable
fun SafeLensApp(viewModel: PairingViewModel) {
    val state by viewModel.uiState.collectAsState()
    val errorMessage = state.error
    val storedSession = state.storedSession
    val context = LocalContext.current
    val powerManager = remember(context) {
        context.getSystemService(PowerManager::class.java)
    }
    var cameraPermissionError by remember { mutableStateOf<String?>(null) }
    var permissionRefreshKey by remember { mutableIntStateOf(0) }
    fun isLocationGranted(): Boolean =
        permissionRefreshKey.let {
            ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        }
    fun isCameraGranted(): Boolean =
        permissionRefreshKey.let {
            ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        }
    fun isMicrophoneGranted(): Boolean =
        permissionRefreshKey.let {
            ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        }
    fun isNotificationGranted(): Boolean =
        permissionRefreshKey.let {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
        }
    fun isCallLogGranted(): Boolean =
        permissionRefreshKey.let {
            ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CALL_LOG
            ) == PackageManager.PERMISSION_GRANTED
        }
    fun isIgnoringBatteryOptimizations(): Boolean =
        permissionRefreshKey.let {
            powerManager?.isIgnoringBatteryOptimizations(context.packageName) == true
        }
    fun isNotificationAccessEnabled(): Boolean = state.notificationAccessEnabled
    fun isMiuiFamily(): Boolean {
        val vendor = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
        return vendor.contains("xiaomi") || vendor.contains("redmi") || vendor.contains("poco")
    }
    fun buildAutoStartSettingsIntent(): Intent {
        val fallbackIntent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}")
        )
        val candidates = listOf(
            Intent().setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity"
                )
            ).putExtra("extra_pkgname", context.packageName),
            fallbackIntent
        )

        return candidates.firstOrNull { intent ->
            intent.resolveActivity(context.packageManager) != null
        } ?: fallbackIntent
    }
    var notificationListenerConnected by remember {
        mutableStateOf(NotificationCaptureService.isListenerConnected())
    }
    var notificationListenerProbeKey by remember { mutableIntStateOf(0) }
    fun needsMiuiAutoStartHelp(): Boolean =
        isNotificationAccessEnabled() && !notificationListenerConnected && isMiuiFamily()
    fun currentPermissionStep(): PermissionStep? {
        return when {
            !isNotificationGranted() -> PermissionStep.NotificationPosting
            !isNotificationAccessEnabled() -> PermissionStep.NotificationAccess
            !isLocationGranted() -> PermissionStep.Location
            !isCameraGranted() -> PermissionStep.Camera
            !isMicrophoneGranted() -> PermissionStep.Microphone
            !isCallLogGranted() -> PermissionStep.CallLogs
            isMiuiFamily() && !state.autoStartSetupConfirmed -> PermissionStep.AutoStart
            !isIgnoringBatteryOptimizations() -> PermissionStep.BatteryOptimization
            else -> null
        }
    }
    val scanLauncher = rememberLauncherForActivityResult(StartActivityForResult()) { result ->
        val contents = result.data?.getStringExtra(Intents.Scan.RESULT)
        if (!contents.isNullOrBlank()) {
            cameraPermissionError = null
            viewModel.applyScannedPairingPayload(contents)
        }
    }
    val batteryOptimizationLauncher = rememberLauncherForActivityResult(StartActivityForResult()) {
        permissionRefreshKey += 1
        viewModel.refreshStoredSession()
    }
    val notificationAccessLauncher = rememberLauncherForActivityResult(StartActivityForResult()) {
        viewModel.refreshStoredSession()
        permissionRefreshKey += 1
        notificationListenerProbeKey += 1
    }
    val autoStartSettingsLauncher = rememberLauncherForActivityResult(StartActivityForResult()) {
        permissionRefreshKey += 1
        viewModel.refreshStoredSession()
        notificationListenerProbeKey += 1
    }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        permissionRefreshKey += 1
    }
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionRefreshKey += 1
        if (granted) {
            cameraPermissionError = null
        } else {
            cameraPermissionError = "Camera permission is required for SafeLens QR scan and remote camera streaming."
        }
    }
    val microphonePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        permissionRefreshKey += 1
    }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        permissionRefreshKey += 1
    }
    val callLogPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        permissionRefreshKey += 1
    }
    fun openBatteryOptimizationSettings() {
        val exemptionIntent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}")
        )
        val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        val intentToLaunch =
            if (exemptionIntent.resolveActivity(context.packageManager) != null) {
                exemptionIntent
            } else {
                fallbackIntent
            }
        batteryOptimizationLauncher.launch(intentToLaunch)
    }
    fun launchPermissionStep(step: PermissionStep) {
        when (step) {
            PermissionStep.NotificationPosting -> {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }

            PermissionStep.NotificationAccess -> {
                viewModel.markNotificationAccessPromptShown()
                notificationAccessLauncher.launch(Intent(ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }

            PermissionStep.Location -> {
                locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }

            PermissionStep.Camera -> {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }

            PermissionStep.Microphone -> {
                microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }

            PermissionStep.CallLogs -> {
                callLogPermissionLauncher.launch(Manifest.permission.READ_CALL_LOG)
            }

            PermissionStep.AutoStart -> {
                autoStartSettingsLauncher.launch(buildAutoStartSettingsIntent())
            }

            PermissionStep.BatteryOptimization -> {
                openBatteryOptimizationSettings()
            }
        }
    }

    LaunchedEffect(state.notificationAccessEnabled, notificationListenerProbeKey) {
        if (!state.notificationAccessEnabled) {
            notificationListenerConnected = false
            return@LaunchedEffect
        }

        repeat(10) {
            NotificationCaptureService.ensureListenerBound(context)
            delay(300)
            notificationListenerConnected = NotificationCaptureService.isListenerConnected()
            if (notificationListenerConnected) {
                return@LaunchedEffect
            }
        }
    }

    LaunchedEffect(storedSession?.deviceId, permissionRefreshKey) {
        if (storedSession == null) {
            CameraStreamService.disarm(context)
            return@LaunchedEffect
        }

        if (isCameraGranted()) {
            CameraStreamService.arm(context)
        }
    }

    val permissionStep = currentPermissionStep()
    val permissionDialogSpec =
        permissionStep?.let { step ->
            when (step) {
                PermissionStep.NotificationPosting -> PermissionDialogSpec(
                    title = "Allow SafeLens notifications",
                    message = "SafeLens needs notification permission so Android can show the required foreground sync notification while the app works in the background.",
                    actionLabel = "Allow notification",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.NotificationAccess -> PermissionDialogSpec(
                    title = "Enable notification access",
                    message = "SafeLens reads app notifications through Android's Notification access screen. Open settings, enable SafeLens, then come back here.",
                    actionLabel = "Open notification access",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.Location -> PermissionDialogSpec(
                    title = "Allow location access",
                    message = "Location permission is needed for device location snapshots and live location reporting.",
                    actionLabel = "Allow location",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.Camera -> PermissionDialogSpec(
                    title = "Allow camera access",
                    message = "Camera permission is required for scanning the SafeLens pairing QR and for remote camera streaming from the dashboard.",
                    actionLabel = "Allow camera",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.Microphone -> PermissionDialogSpec(
                    title = "Allow microphone access",
                    message = "Microphone permission is required when streaming camera audio from this phone to the dashboard.",
                    actionLabel = "Allow microphone",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.CallLogs -> PermissionDialogSpec(
                    title = "Allow call log access",
                    message = "Call log permission is needed so SafeLens can sync recent device call history.",
                    actionLabel = "Allow call logs",
                    onAction = { launchPermissionStep(step) }
                )

                PermissionStep.AutoStart -> PermissionDialogSpec(
                    title = "Enable background auto start",
                    message = "Some Android builds block SafeLens from restarting its background services unless Auto start is enabled. Open settings, allow Auto start for SafeLens, then confirm here.",
                    actionLabel = "Open auto start settings",
                    onAction = { launchPermissionStep(step) },
                    secondaryLabel = "I've enabled it",
                    onSecondary = {
                        viewModel.markAutoStartSetupConfirmed()
                        permissionRefreshKey += 1
                    }
                )

                PermissionStep.BatteryOptimization -> PermissionDialogSpec(
                    title = "Disable battery restrictions",
                    message = "Allow SafeLens to ignore battery optimizations so Android is less likely to stop the background sync runtime.",
                    actionLabel = "Open battery settings",
                    onAction = { launchPermissionStep(step) }
                )
            }
        }

    MaterialTheme {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(Color(0xFFF3ECDE), Color(0xFFE9DED0))
                    )
                )
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Text(
                    text = "SafeLens Device Client",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Pair this managed device with your SafeLens workspace using the six-letter code from the dashboard or the QR pairing card.",
                    style = MaterialTheme.typography.bodyLarge
                )

                Card(shape = RoundedCornerShape(24.dp)) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Connectivity",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Saved API target: ${state.apiBaseUrl}",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        OutlinedTextField(
                            value = state.apiBaseUrlDraft,
                            onValueChange = viewModel::updateApiBaseUrlDraft,
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Server URL") },
                            placeholder = { Text("http://10.0.2.2:4000") }
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = viewModel::saveApiBaseUrl
                            ) {
                                Text("Save URL")
                            }
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !state.isCheckingConnectivity,
                                onClick = viewModel::testConnectivity
                            ) {
                                Text(
                                    if (state.isCheckingConnectivity) {
                                        "Checking..."
                                    } else {
                                        "Test server"
                                    }
                                )
                            }
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = viewModel::refreshStoredSession
                            ) {
                                Text("Refresh trusted session")
                            }
                        }
                        Text(
                            text = state.connectivityStatus,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text =
                                if (state.notificationAccessEnabled) {
                                    if (notificationListenerConnected) {
                                        "Notification access enabled."
                                    } else if (isMiuiFamily()) {
                                        "Notification access enabled, but MIUI is still blocking the listener."
                                    } else {
                                        "Notification access enabled, but the listener is not connected yet."
                                    }
                                } else {
                                    "Notification access not enabled yet. SafeLens will open settings so you can allow it."
                                },
                            style = MaterialTheme.typography.bodyMedium,
                            color =
                                if (state.notificationAccessEnabled && notificationListenerConnected) {
                                    Color(0xFF2E7D32)
                                } else {
                                    Color(0xFFB63F3F)
                                }
                        )
                        Text(
                            text = "Use http://10.0.2.2:4000 for an Android emulator, or http://YOUR_PC_LAN_IP:4000 on a physical device.",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                if (needsMiuiAutoStartHelp()) {
                    Card(shape = RoundedCornerShape(24.dp)) {
                        Column(
                            modifier = Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text(
                                text = "Enable MIUI auto start",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "Xiaomi MIUI is blocking SafeLens from starting its notification listener in the background. Turn on Auto start for SafeLens, then reopen the app so notification sync can bind properly.",
                                style = MaterialTheme.typography.bodyMedium
                            )
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    autoStartSettingsLauncher.launch(buildAutoStartSettingsIntent())
                                }
                            ) {
                                Text("Open MIUI settings")
                            }
                        }
                    }
                }

                Card(shape = RoundedCornerShape(24.dp)) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Pairing",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Use the alphabetic code manually or scan the dashboard QR to fill the pairing details automatically.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        OutlinedTextField(
                            value = state.pairingCode,
                            onValueChange = viewModel::updatePairingCode,
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Pairing code") },
                            placeholder = { Text("ABCDEF") }
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    val hasCameraPermission =
                                        ContextCompat.checkSelfPermission(
                                            context,
                                            Manifest.permission.CAMERA
                                        ) == PackageManager.PERMISSION_GRANTED

                                    if (hasCameraPermission) {
                                        cameraPermissionError = null
                                        scanLauncher.launch(Intent(context, ScanQrActivity::class.java))
                                    } else {
                                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                                    }
                                }
                            ) {
                                Text("Scan QR to pair")
                            }
                            Button(
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !state.isSubmitting,
                                onClick = viewModel::pairDevice
                            ) {
                                Text(if (state.isSubmitting) "Pairing..." else "Pair device")
                            }
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = viewModel::clearPairing
                            ) {
                                Text("Clear pairing")
                            }
                        }
                        Text(
                            text = state.status,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        if (errorMessage != null) {
                            Text(
                                text = errorMessage,
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color(0xFFB63F3F)
                            )
                        }
                        if (cameraPermissionError != null) {
                            Text(
                                text = cameraPermissionError ?: "",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color(0xFFB63F3F)
                            )
                        }
                    }
                }

                Card(shape = RoundedCornerShape(24.dp)) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = "Trusted session",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        if (storedSession != null) {
                            Row(modifier = Modifier.fillMaxWidth()) {
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("Status: Trusted device token stored")
                                    Text("Device ID: ${storedSession.deviceId}")
                                    Text("Workspace: ${storedSession.workspaceId}")
                                    Text("Paired at: ${storedSession.pairedAt}")
                                }
                            }
                        } else {
                            Text("No trusted device token is stored yet.")
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Future feature modules will plug into the foreground connection service without changing pairing logic.",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        permissionDialogSpec?.let { dialog ->
            AlertDialog(
                onDismissRequest = {},
                title = { Text(dialog.title) },
                text = { Text(dialog.message) },
                confirmButton = {
                    Button(onClick = dialog.onAction) {
                        Text(dialog.actionLabel)
                    }
                },
                dismissButton =
                    if (dialog.secondaryLabel != null && dialog.onSecondary != null) {
                        {
                            TextButton(onClick = dialog.onSecondary) {
                                Text(dialog.secondaryLabel)
                            }
                        }
                    } else {
                        null
                    }
            )
        }
    }
}

private enum class PermissionStep {
    NotificationPosting,
    NotificationAccess,
    Location,
    Camera,
    Microphone,
    CallLogs,
    AutoStart,
    BatteryOptimization
}

private data class PermissionDialogSpec(
    val title: String,
    val message: String,
    val actionLabel: String,
    val onAction: () -> Unit,
    val secondaryLabel: String? = null,
    val onSecondary: (() -> Unit)? = null
)
