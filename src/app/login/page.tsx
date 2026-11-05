import { redirect } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { safeNextPath } from "@/lib/nav";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getPageUser()) redirect(next ?? "/");
  return (
    <>
      <header className="topbar">
        <div className="brand">{ctx().config.appName}</div>
        <ThemeToggle />
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 18 }}>Anmelden</h1>
        <LoginForm next={next} />
        <p className="muted" style={{ fontSize: 14, marginTop: 24 }}>Noch kein Konto? Du brauchst einen Einladungslink von jemandem, der schon dabei ist.</p>
      </main>
    </>
  );
}
