import { z } from "zod";

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  createdAt: z.string().datetime()
});

export const workspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  ownerUserId: z.string().uuid(),
  createdAt: z.string().datetime()
});

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(60)
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(24)
});

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(24).optional()
});

export const authSessionSchema = z.object({
  accessToken: z.string().min(24),
  refreshToken: z.string().min(24),
  expiresAt: z.string().datetime(),
  user: userSummarySchema,
  workspace: workspaceSummarySchema
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

