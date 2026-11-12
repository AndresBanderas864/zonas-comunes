import argon2 from 'argon2';
import { createHash, createHmac, randomBytes } from 'node:crypto';

export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function derivarCsrf(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionToken).digest('hex');
}
