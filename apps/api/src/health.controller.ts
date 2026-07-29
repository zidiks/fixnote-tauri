import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator.js";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health(): { status: "ok"; service: "api"; timestamp: string } {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }
}

