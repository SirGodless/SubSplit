import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getPageUser } from "@/lib/server/auth";
import InvitationsPanel from "./InvitationsPanel";

export const dynamic = "force-dynamic";

export default async function InvitationsPage() {
  const auth = await getPageUser();
  if (!auth) redirect("/login");
  return (
    <AppShell user={auth.user} active="/invitations">
      <main className="shell">
        <InvitationsPanel />
      </main>
    </AppShell>
  );
}
