package com.safelens.app

import android.app.Application
import android.app.Activity
import android.os.Bundle

import com.safelens.app.data.DeviceRepository
import com.safelens.app.service.DeviceConnectionService
import com.safelens.app.service.NotificationCaptureService

class SafeLensApplication : Application() {
    val container by lazy { AppContainer(this) }
    @Volatile
    var isInForeground: Boolean = false
        private set

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            private var startedCount = 0

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

            override fun onActivityStarted(activity: Activity) {
                startedCount += 1
                isInForeground = startedCount > 0
            }

            override fun onActivityResumed(activity: Activity) = Unit

            override fun onActivityPaused(activity: Activity) = Unit

            override fun onActivityStopped(activity: Activity) {
                startedCount = (startedCount - 1).coerceAtLeast(0)
                isInForeground = startedCount > 0
            }

            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

            override fun onActivityDestroyed(activity: Activity) = Unit
        })

        if (container.deviceRepository.hasNotificationAccess()) {
            NotificationCaptureService.ensureListenerBound(this)
        }

        if (container.deviceRepository.getStoredSession() != null) {
            DeviceConnectionService.start(this)
        }
    }
}

class AppContainer(application: Application) {
    val deviceRepository = DeviceRepository.create(application)
}
