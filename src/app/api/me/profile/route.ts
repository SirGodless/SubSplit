import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { hasPaymentMethod, updateProfile, updateRecipient } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const patch = z.object({
  displayName: z.string().max(200).optional(),
  email: z.string().max(400).nullable().optional(),
  recipientName: z.string().max(200).nullable().optional(),
  paypalMe: z.string().max(200).nullable().optional(),
  iban: z.string().max(100).nullable().optional(),
  dueDay: z.number().int().optional(),
});

const profile = (u: import("@/lib/services/users").UserRow) => ({
  username: u.username, displayName: u.displayName, email: u.email, role: u.role,
  recipientName: u.recipientName, paypalMe: u.paypalMe, iban: u.iban, dueDay: u.dueDay, hasPaymentMethod: hasPaymentMethod(u),
});

export const GET = userRoute(({ user }) => profile(user));

export const PATCH = userRoute(async ({ user, readBody }) => {
  const c = ctx();
  const input = patch.parse(await readBody());
  c.db.transaction((tx) => {
    const db = tx as unknown as typeof c.db;
    updateProfile(db, user.id, { displayName: input.displayName, email: input.email });
    updateRecipient(db, user.id, { recipientName: input.recipientName, paypalMe: input.paypalMe, iban: input.iban, dueDay: input.dueDay });
  });
  return { ok: true };
});
