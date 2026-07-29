import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface RealtimeUser {
  id: string;
  email?: string;
}

const jwks = process.env.SUPABASE_URL
  ? createRemoteJWKSet(
      new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
    )
  : null;

export async function authenticateToken(token: string): Promise<RealtimeUser> {
  if (process.env.AUTH_MODE === 'mock') {
    const id = token.startsWith('mock:')
      ? token.slice('mock:'.length)
      : process.env.AUTH_MOCK_USER_ID;
    if (!id) throw new Error('Mock user id is missing');
    return { id, email: 'local@fixnote.dev' };
  }

  if (!jwks || !process.env.SUPABASE_URL) {
    throw new Error('Supabase auth is not configured');
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    audience: 'authenticated',
  });

  return payloadToUser(payload);
}

function payloadToUser(payload: JWTPayload): RealtimeUser {
  if (!payload.sub) throw new Error('JWT subject is missing');
  const email = (payload as Record<string, unknown>).email;
  return {
    id: payload.sub,
    ...(typeof email === 'string' ? { email } : {}),
  };
}
