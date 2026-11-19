import Link from "next/link";
import type { ReactNode } from "react";
import { ctx } from "@/lib/server/context";
import { headers } from "next/headers";
import type { SessionUser } from "@/lib/server/session-auth";
import LogoutButton from "./LogoutButton";
import SessionKeepAlive from "./SessionKeepAlive";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/manage", label: "Verwalten" },
  { href: "/settings", label: "Einstellungen" },
] as const;

/** Rahmen für alle angemeldeten Seiten: Kopfzeile, Navigation, Sitzungsverlängerung. */
export default async function AppShell({ user, active, children }: { user: SessionUser; active: string; children: ReactNode }) {
  const links = user.role === "operator" ? [...LINKS, { href: "/operator", label: "Betreiber" }] : [...LINKS];
  // Im Rahmen des Hubs (Sec-Fetch-Dest: iframe) gibt es Kopfzeile, Abmelden und Hell/Dunkel schon im Hub: nur die Navigation bleibt.
  const embedded = (await headers()).get("sec-fetch-dest") === "iframe";
  return (
    <>
      {!embedded && (
      <header className="topbar">
        <div className="brand">{ctx().config.appName}<small>{user.displayName}</small></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      )}
      <nav className="navbar" aria-label="Hauptnavigation">
        <div className="navbar__inner">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.href === active ? "page" : undefined}>{l.label}</Link>
          ))}
        </div>
      </nav>
      <SessionKeepAlive />
      {children}
    </>
  );
}
