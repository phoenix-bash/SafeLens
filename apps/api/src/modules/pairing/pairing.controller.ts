import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import { pairDeviceRequestSchema } from "@safelens/contracts";
import { SessionAuthGuard } from "../../common/auth/session-auth.guard";
import { SessionRequest } from "../../common/auth/session-request";
import { parseSchema } from "../../common/http/parse-schema";
import { PairingService } from "./pairing.service";

@Controller()
export class PairingController {
  constructor(private readonly pairingService: PairingService) {}

  @Get("pairing-codes/:code")
  @UseGuards(SessionAuthGuard)
  getPairingCode(
    @Req() request: SessionRequest,
    @Param("code") code: string
  ) {
    return this.pairingService.getPairingCode(
      request.safelensSession.workspaceId,
      code
    );
  }

  @Post("pairing-codes")
  @UseGuards(SessionAuthGuard)
  createPairingCode(@Req() request: SessionRequest) {
    return this.pairingService.createPairingCode({
      workspaceId: request.safelensSession.workspaceId,
      userId: request.safelensSession.userId
    });
  }

  @Post("devices/pair")
  pairDevice(@Body() body: unknown) {
    const payload = parseSchema(pairDeviceRequestSchema, body);
    return this.pairingService.pairDevice(payload);
  }
}
