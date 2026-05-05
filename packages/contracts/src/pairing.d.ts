import { z } from "zod";
export declare const pairingCodeViewSchema: z.ZodObject<{
    code: z.ZodString;
    workspaceId: z.ZodString;
    expiresAt: z.ZodString;
    claimedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    claimedAt: string | null;
    code: string;
    expiresAt: string;
    workspaceId: string;
}, {
    claimedAt: string | null;
    code: string;
    expiresAt: string;
    workspaceId: string;
}>;
export declare const createPairingCodeResponseSchema: z.ZodObject<{
    code: z.ZodString;
    workspaceId: z.ZodString;
    expiresAt: z.ZodString;
    claimedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    claimedAt: string | null;
    code: string;
    expiresAt: string;
    workspaceId: string;
}, {
    claimedAt: string | null;
    code: string;
    expiresAt: string;
    workspaceId: string;
}>;
export declare const pairDeviceRequestSchema: z.ZodObject<{
    code: z.ZodString;
    deviceName: z.ZodString;
    model: z.ZodString;
    manufacturer: z.ZodString;
    androidVersion: z.ZodString;
    capabilities: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        status: z.ZodEnum<["available", "planned", "unsupported"]>;
    }, "strip", z.ZodTypeAny, {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }, {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    code: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    model: string;
    manufacturer: string;
    androidVersion: string;
    deviceName: string;
}, {
    code: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    model: string;
    manufacturer: string;
    androidVersion: string;
    deviceName: string;
}>;
export declare const pairDeviceResponseSchema: z.ZodObject<{
    deviceId: z.ZodString;
    deviceToken: z.ZodString;
    workspaceId: z.ZodString;
    pairedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    pairedAt: string;
    deviceId: string;
    deviceToken: string;
}, {
    workspaceId: string;
    pairedAt: string;
    deviceId: string;
    deviceToken: string;
}>;
export type PairingCodeView = z.infer<typeof pairingCodeViewSchema>;
export type PairDeviceRequest = z.infer<typeof pairDeviceRequestSchema>;
export type PairDeviceResponse = z.infer<typeof pairDeviceResponseSchema>;
