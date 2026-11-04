import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Format: scrypt:N:r:p:salt(base64url):hash(base64url) – ohne "$", damit docker compose nichts interpoliert. */
const KEYLEN = 32;
const DEFAULT = { N: 65536, r: 8, p: 1 };

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
}

export function hashPassword(password: string, params = DEFAULT): string {
  const salt = randomBytes(16);
  const hash = derive(password, salt, params.N, params.r, params.p);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

/** Gibt bei kaputtem Hash-Format false zurück (nie eine Exception mit Details). */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every(Number.isSafeInteger) || N < 2 || (N & (N - 1)) !== 0 || N > 1 << 20) return false;
  try {
    const expected = Buffer.from(parts[5]!, "base64url");
    const actual = derive(password, Buffer.from(parts[4]!, "base64url"), N, r, p);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
