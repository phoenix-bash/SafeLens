import { Request } from "express";

export interface DevicePrincipal {
  deviceToken: string;
  deviceId: string;
  workspaceId: string;
}

export interface DeviceRequest extends Request {
  safelensDevice: DevicePrincipal;
}
