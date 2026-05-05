import { z } from "zod";

export const callLogTypeSchema = z.enum([
  "incoming",
  "outgoing",
  "missed",
  "rejected",
  "blocked",
  "voicemail",
  "answered_externally",
  "unknown"
]);

export const callLogRecordSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  fingerprint: z.string().min(16).max(128),
  contactName: z.string().min(1).max(160).nullable(),
  phoneNumber: z.string().min(1).max(80),
  callType: callLogTypeSchema,
  durationSeconds: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime()
});

export const callLogIngestItemSchema = z.object({
  clientId: z.string().uuid(),
  fingerprint: z.string().min(16).max(128),
  contactName: z.string().min(1).max(160).nullable().optional(),
  phoneNumber: z.string().min(1).max(80),
  callType: callLogTypeSchema,
  durationSeconds: z.number().int().nonnegative(),
  occurredAt: z.string().datetime()
});

export const callLogBatchIngestRequestSchema = z.object({
  callLogs: z.array(callLogIngestItemSchema).min(1).max(100)
});

export const callLogsPageSchema = z.object({
  items: z.array(callLogRecordSchema),
  nextCursor: z.string().nullable()
});

export const callLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export type CallLogType = z.infer<typeof callLogTypeSchema>;
export type CallLogRecord = z.infer<typeof callLogRecordSchema>;
export type CallLogIngestItem = z.infer<typeof callLogIngestItemSchema>;
export type CallLogBatchIngestRequest = z.infer<
  typeof callLogBatchIngestRequestSchema
>;
export type CallLogsPage = z.infer<typeof callLogsPageSchema>;
export type CallLogsQuery = z.infer<typeof callLogsQuerySchema>;
