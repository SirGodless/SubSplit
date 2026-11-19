import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import type { HubConfig } from "@/lib/config";
import type { HubUser } from "@/lib/hub/client";

/**
 * Ein Hub zum Ausprobieren, ohne Netzwerk: Discovery, JWKS, Token-Endpunkt und Dienst-Schnittstelle als `fetch`-Ersatz.
 * Die Formate sind die des echten Hubs (AuthenticationService, docs/INTEGRATION.md).
 */
export const ISSUER = "https://hub.example";
export const CLIENT_ID = "subsplit";
export const CLIENT_SECRET = "client-geheimnis";
export const HUB_CONFIG: HubConfig = { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, internalUrl: null, origin: ISSUER };
const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export interface MockHub {
  fetch: typeof fetch;
  calls: string[];
  /** Was der nächste Code-Tausch liefert. */
  codes: Map<string, { sub: string; sid?: string; nonce: string; refresh?: string }>;
  /** Gültige Refresh-Tokens (jedes nur einmal). */
  refreshTokens: Set<string>;
  users: Map<string, HubUser>;
  operators: Set<string>;
  down: boolean;
  nextRefresh: number;
  idToken(p: { sub: string; sid?: string; nonce: string; aud?: string; iss?: string; expiresIn?: number }): Promise<string>;
  logoutToken(p: { sub?: string; sid?: string; aud?: string; iss?: string; typ?: string; nonce?: string; events?: unknown; jti?: string }): Promise<string>;
}

export async function createMockHub(): Promise<MockHub> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  const hub: MockHub = {
    calls: [], codes: new Map(), refreshTokens: new Set(), users: new Map(), operators: new Set(), down: false, nextRefresh: 1,
    fetch: undefined as unknown as typeof fetch,
    async idToken(p) {
      return new SignJWT({ nonce: p.nonce, ...(p.sid ? { sid: p.sid } : {}) })
        .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(p.iss ?? ISSUER).setAudience(p.aud ?? CLIENT_ID).setSubject(p.sub)
        .setIssuedAt().setExpirationTime(`${p.expiresIn ?? 1800}s`).sign(privateKey);
    },
    async logoutToken(p) {
      const claims: Record<string, unknown> = { events: p.events ?? { [LOGOUT_EVENT]: {} } };
      if (p.sid) claims.sid = p.sid;
      if (p.nonce) claims.nonce = p.nonce;
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1", typ: p.typ ?? "logout+jwt" }).setIssuer(p.iss ?? ISSUER).setAudience(p.aud ?? CLIENT_ID)
        .setIssuedAt().setExpirationTime("120s").setJti(p.jti ?? crypto.randomUUID());
      if (p.sub) jwt.setSubject(p.sub);
      return jwt.sign(privateKey);
    },
  };
  void otherKey;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  hub.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    hub.calls.push(`${init?.method ?? "GET"} ${path}${url.search ? "?…" : ""}`);
    if (hub.down) throw new TypeError("fetch failed");
    if (path === "/.well-known/openid-configuration") {
      return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth2/authorize`, token_endpoint: `${ISSUER}/oauth2/token`, jwks_uri: `${ISSUER}/oauth2/jwks` });
    }
    if (path === "/oauth2/jwks") return json({ keys: [jwk] });
    if (path === "/oauth2/token") {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`) return json({ error: "invalid_client" }, 401);
      const body = new URLSearchParams(String(init?.body));
      const grant = body.get("grant_type");
      if (grant === "client_credentials") return json({ access_token: "service-token", expires_in: 600, token_type: "Bearer" });
      if (grant === "authorization_code") {
        const c = hub.codes.get(body.get("code") ?? "");
        if (!c || !body.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
        hub.codes.delete(body.get("code")!);
        const refresh = c.refresh ?? `r-${hub.nextRefresh++}`;
        hub.refreshTokens.add(refresh);
        return json({ id_token: await hub.idToken({ sub: c.sub, sid: c.sid, nonce: c.nonce }), refresh_token: refresh, access_token: "a", expires_in: 600 });
      }
      if (grant === "refresh_token") {
        const old = body.get("refresh_token") ?? "";
        if (!hub.refreshTokens.delete(old)) return json({ error: "invalid_grant" }, 400);
        const next = `r-${hub.nextRefresh++}`;
        hub.refreshTokens.add(next);
        return json({ refresh_token: next, access_token: "a", expires_in: 600 });
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (path.startsWith("/api/service/")) {
      if (new Headers(init?.headers).get("authorization") !== "Bearer service-token") return json({ error: "unauthorized" }, 401);
      const perm = /^\/api\/service\/users\/([^/]+)\/permissions$/.exec(path);
      if (perm) {
        const u = hub.users.get(perm[1]!);
        if (!u) return json({ error: "user_unknown" }, 404);
        const permissions = u.access && hub.operators.has(u.sub) ? [{ key: `${CLIENT_ID}.operator`, type: "boolean" }] : [];
        return json({ sub: u.sub, access: u.access && !u.banned, permissions: u.access && !u.banned ? permissions : [] });
      }
      if (path === "/api/service/users") {
        const subs = url.searchParams.getAll("sub");
        const list = subs.length ? subs.map((s) => hub.users.get(s)).filter(Boolean) : [...hub.users.values()].filter((u) => u.access && !u.banned);
        return json({ users: list });
      }
    }
    return json({ error: "not_found" }, 404);
  }) as typeof fetch;
  return hub;
}

export function hubUser(sub: string, name: string, extra: Partial<HubUser> = {}): HubUser {
  return { sub, username: name, email: `${name}@example.org`, emailVerified: true, locale: "de", banned: false, access: true, ...extra };
}
