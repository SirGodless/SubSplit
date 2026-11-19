import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import type { SessionUser } from "@/lib/server/session-auth";
import { hasPaymentMethod, updateRecipient } from "@/lib/services/users";

export const dynamic = "force-dynamic";

// Benutzername und E-Mail gehören zum Konto im Hub und lassen sich nur dort ändern.
const patch = z.object({
  recipientName: z.string().max(200).nullable().optional(),
  paypalMe: z.string().max(200).nullable().optional(),
  iban: z.string().max(100).nullable().optional(),
  dueDay: z.number().int().optional(),
});

const profile = (u: SessionUser) => ({
  username: u.username, displayName: u.displayName, email: u.email, role: u.role,
  emailVerified: u.emailVerified, remindersEnabled: u.remindersEnabled, priceMailsEnabled: u.priceMailsEnabled, mailEnabled: ctx().config.mail !== null,
  recipientName: u.recipientName, paypalMe: u.paypalMe, iban: u.iban, dueDay: u.dueDay, hasPaymentMethod: hasPaymentMethod(u),
});

export const GET = userRoute(({ user }) => profile(user));

export const PATCH = userRoute(async ({ user, readBody }) => {
  const c = ctx();
  const input = patch.parse(await readBody());
  c.db.transaction((tx) => {
    updateRecipient(tx as unknown as typeof c.db, user.id, input);
  });
  return { ok: true };
});
