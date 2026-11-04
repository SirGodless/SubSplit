import ThemeToggle from "@/components/ThemeToggle";
import { ctx } from "@/lib/server/context";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <>
      <header className="topbar">
        <div className="brand">{ctx().config.appName}<small>Admin</small></div>
        <ThemeToggle />
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 18 }}>Anmelden</h1>
        <LoginForm />
      </main>
    </>
  );
}
