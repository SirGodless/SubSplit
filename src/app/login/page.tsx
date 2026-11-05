import { redirect } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getPageUser()) redirect("/");
  return (
    <>
      <header className="topbar">
        <div className="brand">{ctx().config.appName}</div>
        <ThemeToggle />
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 18 }}>Anmelden</h1>
        <LoginForm />
        <p className="muted" style={{ fontSize: 14, marginTop: 24 }}>Noch kein Konto? Du brauchst einen Einladungslink von jemandem, der schon dabei ist.</p>
      </main>
    </>
  );
}
