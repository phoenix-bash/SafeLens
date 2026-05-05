import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Redirect
} from "@nestjs/common";

import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema
} from "@safelens/contracts";
import { parseSchema } from "../../common/http/parse-schema";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(@Body() body: unknown) {
    const payload = parseSchema(registerRequestSchema, body);
    return this.authService.register(payload);
  }

  @Post("login")
  async login(@Body() body: unknown) {
    const payload = parseSchema(loginRequestSchema, body);
    return this.authService.login(payload);
  }

  @Post("refresh")
  async refresh(@Body() body: unknown) {
    const payload = parseSchema(refreshRequestSchema, body);
    return this.authService.refresh(payload.refreshToken);
  }

  @Post("logout")
  async logout(@Body() body: unknown) {
    const payload = parseSchema(logoutRequestSchema, body);
    return this.authService.logout(payload.refreshToken);
  }

  @Get("google/start")
  @Redirect()
  googleStart(@Query("returnTo") returnTo?: string) {
    return {
      url: this.authService.buildGoogleStartUrl(returnTo)
    };
  }

  @Get("google/callback")
  @Redirect()
  async googleCallback(
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("mock_email") mockEmail?: string,
    @Query("mock_name") mockName?: string
  ) {
    return {
      url: await this.authService.exchangeGoogleCallback({
        code,
        state,
        mockEmail,
        mockName
      })
    };
  }
}

