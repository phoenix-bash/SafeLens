package com.safelens.app.device

import com.safelens.app.data.DeviceCapabilityDto

class CapabilityRegistry {
    fun capabilities(): List<DeviceCapabilityDto> {
        return listOf(
            DeviceCapabilityDto(key = "camera", label = "Camera Control", status = "available"),
            DeviceCapabilityDto(key = "screen", label = "Screen Mirroring", status = "planned"),
            DeviceCapabilityDto(key = "location", label = "Location", status = "available"),
            DeviceCapabilityDto(key = "notifications", label = "Notifications", status = "available"),
            DeviceCapabilityDto(key = "call_logs", label = "Call Logs", status = "available")
        )
    }
}
