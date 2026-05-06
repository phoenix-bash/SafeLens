import { z } from "zod";

export const callRecordingSourceSchema = z.enum(["xiaomi", "vivo", "unknown"]);

export const callRecordingRecordSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  fingerprint: z.string().min(16).max(160),
  source: callRecordingSourceSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  extension: z.string().min(1).max(16),
  byteSize: z.number().int().nonnegative(),
  relativePath: z.string().min(1).max(1024),
  capturedAt: z.string().datetime(),
  contentBase64: z.string().min(16),
  createdAt: z.string().datetime()
});

export const callRecordingIngestItemSchema = z.object({
  clientId: z.string().uuid(),
  fingerprint: z.string().min(16).max(160),
  source: callRecordingSourceSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  extension: z.string().min(1).max(16),
  byteSize: z.number().int().nonnegative(),
  relativePath: z.string().min(1).max(1024),
  capturedAt: z.string().datetime(),
  contentBase64: z.string().min(16)
});

export const callRecordingBatchIngestRequestSchema = z.object({
  recordings: z.array(callRecordingIngestItemSchema).min(1).max(20)
});

export const callRecordingsPageSchema = z.object({
  items: z.array(callRecordingRecordSchema),
  nextCursor: z.string().nullable()
});

export const callRecordingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const callRecordingsDownloadRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

export type CallRecordingSource = z.infer<typeof callRecordingSourceSchema>;
export type CallRecordingRecord = z.infer<typeof callRecordingRecordSchema>;
export type CallRecordingIngestItem = z.infer<typeof callRecordingIngestItemSchema>;
export type CallRecordingBatchIngestRequest = z.infer<
  typeof callRecordingBatchIngestRequestSchema
>;
export type CallRecordingsPage = z.infer<typeof callRecordingsPageSchema>;
export type CallRecordingsQuery = z.infer<typeof callRecordingsQuerySchema>;
export type CallRecordingsDownloadRequest = z.infer<
  typeof callRecordingsDownloadRequestSchema
>;
