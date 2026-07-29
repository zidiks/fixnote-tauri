import "reflect-metadata";
import "./env.js";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  assertEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()) ?? true,
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  Logger.log(`FixNote API listening on http://localhost:${port}/api/v1`, "Bootstrap");
}

function assertEnvironment(): void {
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "mock") {
    throw new Error("AUTH_MODE=mock is forbidden in production");
  }
  if (process.env.AUTH_MODE !== "mock" && !process.env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required when Supabase authentication is enabled");
  }
}

void bootstrap();
