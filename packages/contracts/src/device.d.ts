import { z } from "zod";
export declare const featureStatusSchema: z.ZodEnum<["available", "planned", "unsupported"]>;
export declare const deviceCapabilitySchema: z.ZodObject<{
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
}>;
export declare const deviceCapabilityManifestSchema: z.ZodObject<{
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
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
}, {
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
}>;
export declare const deviceSummarySchema: z.ZodObject<{
    id: z.ZodString;
    workspaceId: z.ZodString;
    name: z.ZodString;
    model: z.ZodString;
    manufacturer: z.ZodString;
    androidVersion: z.ZodString;
    isOnline: z.ZodBoolean;
    pairedAt: z.ZodString;
    lastSeenAt: z.ZodString;
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
    id: string;
    name: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    workspaceId: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    isOnline: boolean;
    pairedAt: string;
    lastSeenAt: string;
}, {
    id: string;
    name: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    workspaceId: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    isOnline: boolean;
    pairedAt: string;
    lastSeenAt: string;
}>;
export declare const deviceDetailSchema: z.ZodObject<{
    id: z.ZodString;
    workspaceId: z.ZodString;
    name: z.ZodString;
    model: z.ZodString;
    manufacturer: z.ZodString;
    androidVersion: z.ZodString;
    isOnline: z.ZodBoolean;
    pairedAt: z.ZodString;
    lastSeenAt: z.ZodString;
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
} & {
    activeSessionId: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    workspaceId: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    isOnline: boolean;
    pairedAt: string;
    lastSeenAt: string;
    activeSessionId: string | null;
}, {
    id: string;
    name: string;
    capabilities: {
        status: "available" | "planned" | "unsupported";
        key: string;
        label: string;
    }[];
    workspaceId: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    isOnline: boolean;
    pairedAt: string;
    lastSeenAt: string;
    activeSessionId: string | null;
}>;
export declare const revokeDeviceSessionRequestSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
}, {
    reason?: string | undefined;
}>;
export type DeviceCapability = z.infer<typeof deviceCapabilitySchema>;
export type DeviceCapabilityManifest = z.infer<typeof deviceCapabilityManifestSchema>;
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;
export type DeviceDetail = z.infer<typeof deviceDetailSchema>;
export type RevokeDeviceSessionRequest = z.infer<typeof revokeDeviceSessionRequestSchema>;
