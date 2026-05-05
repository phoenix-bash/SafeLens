import { z } from "zod";

export const notificationRecordSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  packageName: z.string().min(1).max(200),
  appLabel: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  text: z.string().min(1).max(2000),
  postedAt: z.string().datetime(),
  createdAt: z.string().datetime()
});

export const notificationIngestItemSchema = z.object({
  clientId: z.string().uuid(),
  fingerprint: z.string().min(16).max(128),
  packageName: z.string().min(1).max(200),
  appLabel: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  text: z.string().min(1).max(2000),
  postedAt: z.string().datetime()
});

export const notificationBatchIngestRequestSchema = z.object({
  notifications: z.array(notificationIngestItemSchema).min(1).max(50)
});

export const notificationAppGroupSchema = z.object({
  appLabel: z.string().min(1).max(120),
  count: z.number().int().nonnegative()
});

export const notificationsPageSchema = z.object({
  items: z.array(notificationRecordSchema),
  nextCursor: z.string().nullable(),
  appGroups: z.array(notificationAppGroupSchema)
});

export const notificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  appLabel: z.string().min(1).max(120).optional(),
  query: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export type NotificationRecord = z.infer<typeof notificationRecordSchema>;
export type NotificationIngestItem = z.infer<typeof notificationIngestItemSchema>;
export type NotificationBatchIngestRequest = z.infer<
  typeof notificationBatchIngestRequestSchema
>;
export type NotificationAppGroup = z.infer<typeof notificationAppGroupSchema>;
export type NotificationsPage = z.infer<typeof notificationsPageSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
