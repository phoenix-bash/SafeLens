import { z } from "zod";
export declare const userSummarySchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    displayName: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
}, {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
}>;
export declare const workspaceSummarySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    ownerUserId: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    name: string;
    ownerUserId: string;
}, {
    id: string;
    createdAt: string;
    name: string;
    ownerUserId: string;
}>;
export declare const registerRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    displayName: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    displayName: string;
    password: string;
}, {
    email: string;
    displayName: string;
    password: string;
}>;
export declare const loginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const refreshRequestSchema: z.ZodObject<{
    refreshToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refreshToken: string;
}, {
    refreshToken: string;
}>;
export declare const logoutRequestSchema: z.ZodObject<{
    refreshToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    refreshToken?: string | undefined;
}, {
    refreshToken?: string | undefined;
}>;
export declare const authSessionSchema: z.ZodObject<{
    accessToken: z.ZodString;
    refreshToken: z.ZodString;
    expiresAt: z.ZodString;
    user: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        displayName: z.ZodString;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        email: string;
        displayName: string;
        createdAt: string;
    }, {
        id: string;
        email: string;
        displayName: string;
        createdAt: string;
    }>;
    workspace: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        ownerUserId: z.ZodString;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        createdAt: string;
        name: string;
        ownerUserId: string;
    }, {
        id: string;
        createdAt: string;
        name: string;
        ownerUserId: string;
    }>;
}, "strip", z.ZodTypeAny, {
    user: {
        id: string;
        email: string;
        displayName: string;
        createdAt: string;
    };
    workspace: {
        id: string;
        createdAt: string;
        name: string;
        ownerUserId: string;
    };
    refreshToken: string;
    accessToken: string;
    expiresAt: string;
}, {
    user: {
        id: string;
        email: string;
        displayName: string;
        createdAt: string;
    };
    workspace: {
        id: string;
        createdAt: string;
        name: string;
        ownerUserId: string;
    };
    refreshToken: string;
    accessToken: string;
    expiresAt: string;
}>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
