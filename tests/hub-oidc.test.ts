import { beforeEach, describe, expect, it } from "vitest";
import { HubOidc, HubError, newPkce } from "@/lib/hub/oidc";
import { createMockHub, HUB_CONFIG, ISSUER, type MockHub } from "./mock-hub";

const SUB = "3f0c1d2e-7a55-4a3e-9d0b-0f6c1b7f1a11";
const REDIRECT = "https://abos.example.org/auth/callback";
let hub: MockHub;
let oidc: HubOidc;

beforeEach(async () => {
  hub = await createMockHub();
  oidc = new HubOidc(HUB_CONFIG, hub.fetch);
});

async function expectKind(p: Promise<unknown>, kind: HubError["kind"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HubError);
  expect((err as HubError).kind).toBe(kind);
}

describe("Anmeldung: Authorize-Adresse und Code-Tausch", () => {
  it("die Authorize-Adresse enthält Code-Flow, PKCE (S256), state, nonce und die Scopes openid offline_access", async () => {
    const { challenge } = newPkce();
    const u = new URL(await oidc.authorizeUrl({ redirectUri: REDIRECT, state: "st", nonce: "no", challenge }));
    expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code", client_id: "subsplit", redirect_uri: REDIRECT, scope: "openid offline_access", state: "st", nonce: "no", code_challenge: challenge, code_challenge_method: "S256",
    });
  });
  it("PKCE: Verifier und Challenge passen zusammen (SHA-256, base64url)", async () => {
    const { verifier, challenge } = newPkce();
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    expect(challenge).toBe(digest);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
  it("Code tauschen: Kennung, Sitzung des Hubs und Refresh-Token kommen zurück", async () => {
    hub.codes.set("c1", { sub: SUB, sid: "sid-1", nonce: "n1" });
    expect(await oidc.exchangeCode("c1", "verifier", REDIRECT, "n1")).toEqual({ sub: SUB, sid: "sid-1", refreshToken: "r-1" });
  });
  it("lehnt ein ID-Token mit falschem nonce, falschem Empfänger, falschem Aussteller, abgelaufen oder ohne gültige UUID ab", async () => {
    const attempts: Array<[string, Parameters<MockHub["idToken"]>[0]]> = [
      ["nonce", { sub: SUB, nonce: "anderes" }], ["aud", { sub: SUB, nonce: "n", aud: "anderer-dienst" }],
      ["iss", { sub: SUB, nonce: "n", iss: "https://boese.example" }], ["abgelaufen", { sub: SUB, nonce: "n", expiresIn: -60 }],
      ["sub", { sub: "admin", nonce: "n" }],
    ];
    for (const [name, p] of attempts) {
      const idToken = await hub.idToken(p);
      const original = hub.fetch;
      oidc = new HubOidc(HUB_CONFIG, (async (i: string | URL | Request, init?: RequestInit) =>
        new URL(String(i)).pathname === "/oauth2/token" && String(init?.body).includes("authorization_code")
          ? new Response(JSON.stringify({ id_token: idToken, refresh_token: "r" }), { status: 200 })
          : original(i, init)) as typeof fetch);
      await expectKind(oidc.exchangeCode("c", "v", REDIRECT, "n"), "invalid"), name;
    }
  });
  it("lehnt ein ID-Token ab, das mit einem fremden Schlüssel oder mit HS256 signiert ist", async () => {
    const other = await createMockHub(); // eigener Schlüssel, nicht im JWKS des ersten Hubs
    const foreign = await other.idToken({ sub: SUB, nonce: "n" });
    const { SignJWT } = await import("jose");
    const hs = await new SignJWT({ nonce: "n" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(ISSUER).setAudience("subsplit").setSubject(SUB).setExpirationTime("5m").sign(new TextEncoder().encode("x".repeat(32)));
    for (const idToken of [foreign, hs]) {
      const original = hub.fetch;
      oidc = new HubOidc(HUB_CONFIG, (async (i: string | URL | Request, init?: RequestInit) =>
        new URL(String(i)).pathname === "/oauth2/token" && String(init?.body).includes("authorization_code")
          ? new Response(JSON.stringify({ id_token: idToken }), { status: 200 })
          : original(i, init)) as typeof fetch);
      await expectKind(oidc.exchangeCode("c", "v", REDIRECT, "n"), "invalid");
    }
  });
  it("ein abgelehnter Code ist invalid_grant, ein ausgefallener Hub ist unavailable", async () => {
    await expectKind(oidc.exchangeCode("unbekannt", "v", REDIRECT, "n"), "invalid_grant");
    hub.down = true;
    oidc = new HubOidc(HUB_CONFIG, hub.fetch);
    await expectKind(oidc.exchangeCode("c", "v", REDIRECT, "n"), "unavailable");
  });
  it("Discovery eines anderen Ausstellers wird nicht akzeptiert", async () => {
    const bad = new HubOidc({ ...HUB_CONFIG, issuer: "https://anderer.example" }, hub.fetch);
    await expectKind(bad.authorizeUrl({ redirectUri: REDIRECT, state: "s", nonce: "n", challenge: "c" }), "invalid");
  });
});

describe("Refresh", () => {
  it("jedes Refresh-Token gilt einmal, das neue kommt zurück", async () => {
    hub.refreshTokens.add("alt");
    expect(await oidc.refresh("alt")).toEqual({ refreshToken: "r-1" });
    await expectKind(oidc.refresh("alt"), "invalid_grant");
  });
  it("Hub nicht erreichbar: unavailable (nicht invalid_grant, sonst würde jede Störung abmelden)", async () => {
    hub.down = true;
    await expectKind(oidc.refresh("x"), "unavailable");
  });
});

describe("Logout-Token", () => {
  it("gültig mit sid, gültig ohne sid (nur sub)", async () => {
    expect(await oidc.verifyLogoutToken(await hub.logoutToken({ sub: SUB, sid: "s1" }))).toMatchObject({ sub: SUB, sid: "s1" });
    expect(await oidc.verifyLogoutToken(await hub.logoutToken({ sub: SUB }))).toMatchObject({ sub: SUB, sid: null });
  });
  it("lehnt ab: falscher typ, nonce, fehlendes Ereignis, falscher Empfänger oder Aussteller, weder sub noch sid, ein ID-Token", async () => {
    const bad = [
      await hub.logoutToken({ sub: SUB, typ: "JWT" }), await hub.logoutToken({ sub: SUB, nonce: "n" }), await hub.logoutToken({ sub: SUB, events: {} }),
      await hub.logoutToken({ sub: SUB, aud: "anderer" }), await hub.logoutToken({ sub: SUB, iss: "https://boese.example" }), await hub.logoutToken({}),
      await hub.idToken({ sub: SUB, nonce: "n" }),
    ];
    for (const t of bad) await expectKind(oidc.verifyLogoutToken(t), "invalid");
    await expectKind(oidc.verifyLogoutToken("kein.jwt.token"), "invalid");
  });
});

describe("Dienst-Schnittstelle", () => {
  it("das Token des Dienstes wird wiederverwendet, die Aufrufe tragen es", async () => {
    hub.users.set(SUB, { sub: SUB, username: "anna", email: null, emailVerified: false, locale: "de", banned: false, access: true });
    await oidc.serviceGet(`/api/service/users/${SUB}/permissions`);
    await oidc.serviceGet(`/api/service/users/${SUB}/permissions`);
    expect(hub.calls.filter((c) => c === "POST /oauth2/token")).toHaveLength(1);
  });
  it("mit OIDC_INTERNAL_URL gehen Aufrufe von Server zu Server direkt zum Hub, nur die Authorize-Adresse bleibt öffentlich", async () => {
    const seen: string[] = [];
    const inner = hub.fetch;
    const internal = new HubOidc({ ...HUB_CONFIG, internalUrl: "http://auth-backend:8080" }, (async (i: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(i));
      seen.push(u.origin);
      return inner(`${ISSUER}${u.pathname}${u.search}`, init); // der Mock kennt nur die öffentliche Adresse
    }) as typeof fetch);
    const url = await internal.authorizeUrl({ redirectUri: REDIRECT, state: "s", nonce: "n", challenge: "c" });
    expect(url.startsWith(`${ISSUER}/oauth2/authorize`)).toBe(true);
    await internal.serviceToken();
    expect(new Set(seen)).toEqual(new Set(["http://auth-backend:8080"]));
  });
});
