import type { HubOidc } from "./oidc";

/** Ein Nutzer, wie der Hub ihn für diesen Dienst liefert (GET /api/service/users). */
export interface HubUser {
  sub: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  locale: string;
  banned: boolean;
  /** Darf den Dienst nutzen (Recht service.<key> vorhanden und nicht gesperrt). */
  access: boolean;
}

export interface HubPermissions {
  access: boolean;
  permissions: Array<{ key: string; type: "boolean" | "number"; value?: number; unlimited?: boolean }>;
}

/** Das Recht, das im Hub einen Betreiber von SubSplit ausmacht (Rechte eines Dienstes tragen seinen Schlüssel als Präfix). */
export const operatorPermission = (clientId: string) => `${clientId}.operator`;

const CHUNK = 100; // so viele Nutzer erlaubt der Hub pro Abfrage

export class HubApi {
  constructor(private readonly oidc: HubOidc, private readonly clientId: string) {}

  async permissionsOf(sub: string): Promise<HubPermissions> {
    return this.oidc.serviceGet<HubPermissions>(`/api/service/users/${encodeURIComponent(sub)}/permissions`);
  }

  async isOperator(sub: string): Promise<{ access: boolean; operator: boolean }> {
    const p = await this.permissionsOf(sub);
    return { access: p.access, operator: p.access && p.permissions.some((x) => x.key === operatorPermission(this.clientId)) };
  }

  /** Bestimmte Nutzer, auch solche ohne Zugang (damit Namen in alten Daten angezeigt werden können). */
  async users(subs: string[]): Promise<HubUser[]> {
    const out: HubUser[] = [];
    for (let i = 0; i < subs.length; i += CHUNK) {
      const query = subs.slice(i, i + CHUNK).map((s) => `sub=${encodeURIComponent(s)}`).join("&");
      out.push(...(await this.oidc.serviceGet<{ users: HubUser[] }>(`/api/service/users?${query}`)).users);
    }
    return out;
  }

  /** Alle Nutzer mit Zugang zu diesem Dienst. */
  async usersWithAccess(): Promise<HubUser[]> {
    return (await this.oidc.serviceGet<{ users: HubUser[] }>("/api/service/users")).users;
  }
}
