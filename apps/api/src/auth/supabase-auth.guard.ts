import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AuthenticatedUser } from "./auth.types.js";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly reflector = new Reflector();
  private readonly jwks = process.env.SUPABASE_URL
    ? createRemoteJWKSet(
        new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
      )
    : null;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    if (process.env.AUTH_MODE === "mock") {
      const id =
        request.header("x-fixnote-user") ??
        process.env.AUTH_MOCK_USER_ID ??
        "00000000-0000-4000-8000-000000000001";
      request.user = {
        id,
        email: request.header("x-fixnote-email") ?? "local@fixnote.dev",
        displayName: "Local User",
      };
      return true;
    }

    const token = bearerToken(request.header("authorization"));
    if (!token || !this.jwks) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${process.env.SUPABASE_URL}/auth/v1`,
        audience: "authenticated",
      });
      request.user = payloadToUser(payload);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired Supabase token");
    }
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? null;
}

function payloadToUser(payload: JWTPayload): AuthenticatedUser {
  if (!payload.sub) throw new UnauthorizedException("JWT subject is missing");
  const metadata =
    payload.user_metadata && typeof payload.user_metadata === "object"
      ? (payload.user_metadata as Record<string, unknown>)
      : {};
  const displayName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : undefined;
  return {
    id: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

