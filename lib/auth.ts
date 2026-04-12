import { createHmac } from "crypto";

const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
const PASSWORD = process.env.AUTH_PASSWORD || "";
const COOKIE = "tft_auth";
const MAX_AGE_DAYS = 90;

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("hex").slice(0, 32);
}

export function isAuthEnabled(): boolean {
  return PASSWORD.length > 0;
}

export function verifyPassword(input: string): boolean {
  return isAuthEnabled() && input === PASSWORD;
}

export function makeToken(): string {
  const ts = Date.now().toString(36);
  return `${ts}.${sign(ts)}`;
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;
  if (sign(ts) !== sig) return false;
  const ageMs = Date.now() - parseInt(ts, 36);
  return ageMs >= 0 && ageMs < MAX_AGE_DAYS * 86400 * 1000;
}

export function cookieName(): string {
  return COOKIE;
}

export function cookieHeader(token: string, secure = true): string {
  const attrs = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_DAYS * 86400}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function parseCookie(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}
