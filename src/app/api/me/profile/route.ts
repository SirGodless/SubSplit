import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { ctx, kickMail, mailCtx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { startEmailVerification } from "@/lib/services/email";
import { AppError } from "@/lib/services/errors";
import { hasPaymentMethod, updateProfile, updateRecipient, type UserRow } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const patch = z.object({
  displayName: z.string().max(200).optional(),
  email: z.string().max(400).nullable().optional(),
  recipientName: z.string().max(200).nullable().optional(),
  paypalMe: z.string().max(200).nullable().optional(),
  iban: z.string().max(100).nullable().optional(),
  dueDay: z.number().int().optional(),
});

const profile = (u: UserRow) => ({
  username: u.username, displayName: u.displayName, email: u.email, role: u.role,
  emailVerified: !!u.emailVerifiedAt, remindersEnabled: u.remindersEnabled, priceMailsEnabled: u.priceMailsEnabled, mailEnabled: ctx().config.mail !== null,
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
  // Neue Adresse: Bestätigungsmail schicken (ein Fehler dabei, z. B. das Stundenlimit, lässt das Speichern nicht scheitern)
  const after = c.db.select().from(users).where(eq(users.id, user.id)).get();
  const m = mailCtx();
  let verificationSent = false;
  if (m && after && after.email && !after.emailVerifiedAt && after.email !== user.email) {
    try {
      startEmailVerification(c.db, m, user.id);
      kickMail();
      verificationSent = true;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }
  return { ok: true, verificationSent };
});
