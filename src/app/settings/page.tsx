import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = await getPageUser();
  if (!auth) redirect("/login");
  const u = auth.user;
  return (
    <AppShell user={u} active="/settings">
      <main className="shell">
        <SettingsForm
          initial={{
            username: u.username, email: u.email ?? "", hubAccountUrl: `${ctx().config.hub.origin}/account`, recipientName: u.recipientName ?? "", paypalMe: u.paypalMe ?? "", iban: u.iban ?? "", dueDay: u.dueDay,
            emailVerified: u.emailVerified, remindersEnabled: u.remindersEnabled, priceMailsEnabled: u.priceMailsEnabled, mailEnabled: ctx().config.mail !== null,
          }}
        />
      </main>
    </AppShell>
  );
}
