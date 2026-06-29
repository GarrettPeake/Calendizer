/**
 * Authentication primitives built on WebCrypto (no dependencies):
 *  - PBKDF2-HMAC-SHA256 password hashing
 *  - compact HMAC-SHA256 signed bearer tokens (a minimal JWT-like)
 */

const PBKDF2_ITERATIONS = 100_000;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

/** Constant-time string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return toB64(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { hash, salt: toB64(salt) };
}

export async function verifyPassword(password: string, hash: string, saltB64: string): Promise<boolean> {
  const computed = await pbkdf2(password, fromB64(saltB64));
  return timingSafeEqual(computed, hash);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

/** Sign a bearer token carrying the user id and an expiry. */
export async function signToken(userId: string, secret: string): Promise<string> {
  const payload = b64url(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

/** Verify a bearer token; returns the user id or null. */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(b64urlDecode(payload));
    if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) return null;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}
