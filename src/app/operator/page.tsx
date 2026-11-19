import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import OperatorApp from "./OperatorApp";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const auth = await getPageUser();
  if (!auth) redirect("/login");
  if (auth.user.role !== "operator") notFound();
  return (
    <AppShell user={auth.user} active="/operator">
      <main className="shell shell--wide" style={{ paddingTop: 22 }}>
        <OperatorApp hubUrl={ctx().config.hub.origin} />
      </main>
    </AppShell>
  );
}
