import Link from "next/link";
import type { ReactNode } from "react";
import { ctx } from "@/lib/server/context";
import { canCreateInvitations } from "@/lib/services/invitations";
import type { UserRow } from "@/lib/services/users";
import LogoutButton from "./LogoutButton";
import SessionKeepAlive from "./SessionKeepAlive";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/manage", label: "Verwalten" },
  { href: "/invitations", label: "Einladungen" },
  { href: "/settings", label: "Einstellungen" },
] as const;

/** Rahmen für alle angemeldeten Seiten: Kopfzeile, Navigation, Sitzungsverlängerung. */
export default function AppShell({ user, active, children }: { user: UserRow; active: string; children: ReactNode }) {
  const base = canCreateInvitations(user, ctx().config.invite) ? LINKS : LINKS.filter((l) => l.href !== "/invitations");
  const links = user.role === "operator" ? [...base, { href: "/operator", label: "Betreiber" }] : base;
  return (
    <>
      <header className="topbar">
        <div className="brand">{ctx().config.appName}<small>{user.displayName}</small></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
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
