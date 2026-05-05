import { z } from "zod";

export const telemetrySnapshotKindSchema = z.enum([
  "device_info",
  "battery",
  "location"
]);

export const deviceInfoSnapshotSchema = z.object({
  deviceName: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  manufacturer: z.string().min(1).max(120),
  androidVersion: z.string().min(1).max(40),
  buildId: z.string().min(1).max(120),
  fingerprint: z.string().min(16).max(128),
  totalRamBytes: z.number().int().nonnegative(),
  availableStorageBytes: z.number().int().nonnegative(),
  totalStorageBytes: z.number().int().positive(),
  sensors: z.array(z.string().min(1)).max(128),
  batteryOptimizationIgnored: z.boolean()
});

export const batterySnapshotSchema = z.object({
  levelPercent: z.number().int().min(0).max(100),
  isCharging: z.boolean(),
  statusLabel: z.string().min(1).max(60)
});

export const locationSnapshotSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  provider: z.string().min(1).max(40),
  isEnabled: z.boolean().optional(),
  statusLabel: z.string().min(1).max(60).optional()
});

export const telemetrySnapshotPayloadSchema = z.object({
  deviceInfo: deviceInfoSnapshotSchema.optional(),
  battery: batterySnapshotSchema.optional(),
  location: locationSnapshotSchema.optional()
});

export const telemetrySnapshotIngestSchema = z.object({
  clientId: z.string().uuid(),
  kind: telemetrySnapshotKindSchema,
  collectedAt: z.string().datetime(),
  payload: telemetrySnapshotPayloadSchema
});

export const telemetryBatchIngestRequestSchema = z.object({
  snapshots: z.array(telemetrySnapshotIngestSchema).min(1).max(50)
});

export const telemetryHistoryItemSchema = z.object({
  id: z.string().uuid(),
  kind: telemetrySnapshotKindSchema,
  collectedAt: z.string().datetime(),
  payload: telemetrySnapshotPayloadSchema
});

export const deviceTelemetryStateSchema = z.object({
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  locationReportingEnabled: z.boolean(),
  locationIntervalMinutes: z.number().int().min(5).max(15),
  latestInfoAt: z.string().datetime().nullable(),
  latestBatteryAt: z.string().datetime().nullable(),
  latestLocationAt: z.string().datetime().nullable(),
  latestInfo: deviceInfoSnapshotSchema.nullable(),
  latestBattery: batterySnapshotSchema.nullable(),
  latestLocation: locationSnapshotSchema.nullable(),
  recentHistory: z.array(telemetryHistoryItemSchema)
});

export const updateLocationReportingRequestSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(5).max(15).optional()
});

export type TelemetrySnapshotKind = z.infer<typeof telemetrySnapshotKindSchema>;
export type DeviceInfoSnapshot = z.infer<typeof deviceInfoSnapshotSchema>;
export type BatterySnapshot = z.infer<typeof batterySnapshotSchema>;
export type LocationSnapshot = z.infer<typeof locationSnapshotSchema>;
export type TelemetrySnapshotIngest = z.infer<
  typeof telemetrySnapshotIngestSchema
>;
export type TelemetryBatchIngestRequest = z.infer<
  typeof telemetryBatchIngestRequestSchema
>;
export type DeviceTelemetryState = z.infer<typeof deviceTelemetryStateSchema>;
export type UpdateLocationReportingRequest = z.infer<
  typeof updateLocationReportingRequestSchema
>;
