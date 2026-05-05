package com.safelens.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

import com.safelens.app.data.DeviceRepository

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) {
            return
        }

        val repository = DeviceRepository.create(context.applicationContext as android.app.Application)
        if (repository.getStoredSession() != null) {
            DeviceConnectionService.start(context)
        }
    }
}
