import { Request } from "express";

export interface SessionPrincipal {
  accessToken: string;
  userId: string;
  workspaceId: string;
}

export interface SessionRequest extends Request {
  safelensSession: SessionPrincipal;
}

