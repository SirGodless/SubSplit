import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { SESSION_COOKIE, verifySession } from "@/lib/security/session";
import { ctx } from "@/lib/server/context";
import AdminApp from "./AdminApp";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const c = ctx();
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value, c.config.sessionSecret);
  if (!session) redirect("/admin/login");
  return (
    <>
      <header className="topbar">
        <div className="brand">{c.config.appName}<small>Admin</small></div>
        <ThemeToggle />
      </header>
      <AdminApp dueDay={c.config.dueDay} />
    </>
  );
}
