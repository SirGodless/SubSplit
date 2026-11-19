import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import type { HubConfig } from "@/lib/config";

/**
 * Der OpenID-Connect-Client zum Hub (AuthenticationService): Anmeldung mit Authorization Code und PKCE, Prüfung der Tokens
 * (Signatur, Aussteller, Empfänger, Ablauf), Refresh und das Logout-Token des Hubs. Beschreibung des Hubs: docs/INTEGRATION.md
 * im Repo AuthenticationService.
 */

export class HubError extends Error {
  constructor(message: string, public readonly kind: "invalid_grant" | "unavailable" | "invalid") {
    super(message);
    this.name = "HubError";
  }
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface LoginResult {
  sub: string;
  sid: string | null;
  refreshToken: string | null;
}

export interface LogoutClaims {
  sub: string | null;
  sid: string | null;
  jti: string;
}

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export class HubOidc {
  private discovery: { doc: Discovery; at: number } | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private serviceTokenCache: { value: string; expires: number } | null = null;

  constructor(private readonly cfg: HubConfig, private readonly doFetch: typeof fetch = fetch) {}

  /** Adresse für Aufrufe von Server zu Server: Mit OIDC_INTERNAL_URL geht es direkt zum Hub, sonst über die öffentliche Adresse. */
  serverUrl(publicUrl: string): string {
    const { issuer, internalUrl } = this.cfg;
    return internalUrl && publicUrl.startsWith(issuer) ? internalUrl + publicUrl.slice(issuer.length) : publicUrl;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.doFetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new HubError("Der Hub ist nicht erreichbar.", "unavailable");
    }
  }

  private async load(): Promise<Discovery> {
    if (this.discovery && Date.now() - this.discovery.at < DISCOVERY_TTL_MS) return this.discovery.doc;
    const res = await this.request(this.serverUrl(`${this.cfg.issuer}/.well-known/openid-configuration`));
    if (!res.ok) throw new HubError(`Discovery des Hubs liefert ${res.status}.`, "unavailable");
    const doc = (await res.json()) as Discovery;
    // Der Aussteller muss genau der konfigurierte sein, sonst könnte jemand eine fremde Konfiguration unterschieben
    if (doc.issuer !== this.cfg.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new HubError("Die Discovery des Hubs passt nicht zu OIDC_ISSUER.", "invalid");
    }
    this.discovery = { doc, at: Date.now() };
    this.jwks = createRemoteJWKSet(new URL(this.serverUrl(doc.jwks_uri)), { [customFetch]: this.doFetch, timeoutDuration: TIMEOUT_MS });
    return doc;
  }

  private async keys() {
    await this.load();
    return this.jwks!;
  }

  async authorizeUrl(p: { redirectUri: string; state: string; nonce: string; challenge: string }): Promise<string> {
    const d = await this.load();
    const u = new URL(d.authorization_endpoint); // öffentliche Adresse: Der Browser geht dorthin, nicht der Server
    u.search = new URLSearchParams({
      response_type: "code", client_id: this.cfg.clientId, redirect_uri: p.redirectUri,
      // offline_access: Refresh-Token, damit der Zugang regelmäßig neu geprüft werden kann
      scope: "openid offline_access", state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }

  private async tokenRequest(params: Record<string, string>): Promise<Response> {
    const d = await this.load();
    const basic = Buffer.from(`${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`).toString("base64");
    return this.request(this.serverUrl(d.token_endpoint), {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  }

  /** Tauscht den Code gegen Tokens und prüft das ID-Token. Wirft HubError bei allem, was nicht stimmt. */
  async exchangeCode(code: string, verifier: string, redirectUri: string, nonce: string): Promise<LoginResult> {
    const res = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
    if (!res.ok) throw new HubError(`Der Hub hat den Code abgelehnt (${res.status}).`, res.status >= 500 ? "unavailable" : "invalid_grant");
    const body = (await res.json()) as { id_token?: string; refresh_token?: string };
    if (!body.id_token) throw new HubError("Die Antwort des Hubs enthält kein ID-Token.", "invalid");
    let payload: JWTPayload;
    try {
      payload = (await jwtVerify(body.id_token, await this.keys(), { issuer: this.cfg.issuer, audience: this.cfg.clientId, algorithms: ["RS256"] })).payload;
    } catch {
      throw new HubError("Das ID-Token ist ungültig.", "invalid");
    }
    if (payload.nonce !== nonce) throw new HubError("Das ID-Token gehört nicht zu dieser Anmeldung.", "invalid");
    if (typeof payload.sub !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new HubError("Das ID-Token hat keine gültige Kennung.", "invalid");
    return { sub: payload.sub, sid: typeof payload.sid === "string" ? payload.sid : null, refreshToken: body.refresh_token ?? null };
  }

  /** Neues Refresh-Token. invalid_grant heißt: Der Zugang besteht nicht mehr (Bann, Recht entzogen, Hub-Sitzung beendet). */
  async refresh(refreshToken: string): Promise<{ refreshToken: string | null }> {
    const res = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (res.status === 400 || res.status === 401) throw new HubError("Der Zugang besteht nicht mehr.", "invalid_grant");
    if (!res.ok) throw new HubError(`Der Hub antwortet mit ${res.status}.`, "unavailable");
    const body = (await res.json()) as { refresh_token?: string };
    return { refreshToken: body.refresh_token ?? null };
  }

  /** Prüft ein Logout-Token (Back-Channel-Logout). Das jti-Merken gegen Wiederholung macht der Aufrufer. */
  async verifyLogoutToken(token: string): Promise<LogoutClaims> {
    let payload: JWTPayload;
    try {
      payload = (await jwtVerify(token, await this.keys(), {
        issuer: this.cfg.issuer, audience: this.cfg.clientId, algorithms: ["RS256"], typ: "logout+jwt", requiredClaims: ["iat", "exp", "jti"],
      })).payload;
    } catch {
      throw new HubError("Das Logout-Token ist ungültig.", "invalid");
    }
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== "object" || !(LOGOUT_EVENT in events)) throw new HubError("Das Logout-Token enthält das Ereignis nicht.", "invalid");
    if ("nonce" in payload) throw new HubError("Ein Logout-Token darf kein nonce haben.", "invalid");
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    if (!sub && !sid) throw new HubError("Das Logout-Token nennt weder Nutzer noch Sitzung.", "invalid");
    return { sub, sid, jti: payload.jti! };
  }

  /** Token dieses Dienstes für die Dienst-Schnittstelle des Hubs (client_credentials). Wird bis kurz vor Ablauf wiederverwendet. */
  async serviceToken(): Promise<string> {
    const c = this.serviceTokenCache;
    if (c && Date.now() < c.expires - 30_000) return c.value;
    const res = await this.tokenRequest({ grant_type: "client_credentials", scope: "service" });
    if (!res.ok) throw new HubError(`Der Hub gibt dem Dienst kein Token (${res.status}).`, res.status >= 500 ? "unavailable" : "invalid");
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.serviceTokenCache = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  /** GET auf die Dienst-Schnittstelle (/api/service/...). */
  async serviceGet<T>(path: string): Promise<T> {
    const token = await this.serviceToken();
    const res = await this.request(this.serverUrl(`${this.cfg.issuer}${path}`), { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) this.serviceTokenCache = null; // abgelaufen oder Geheimnis erneuert: beim nächsten Mal neu holen
    if (!res.ok) throw new HubError(`Der Hub antwortet auf ${path.split("?")[0]} mit ${res.status}.`, res.status >= 500 || res.status === 401 || res.status === 429 ? "unavailable" : "invalid");
    return (await res.json()) as T;
  }
}
