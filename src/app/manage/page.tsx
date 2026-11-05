import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getPageUser } from "@/lib/server/auth";
import ManageApp from "./ManageApp";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const auth = await getPageUser();
  if (!auth) redirect("/login");
  return (
    <AppShell user={auth.user} active="/manage">
      <ManageApp selfId={auth.user.id} />
    </AppShell>
  );
}
