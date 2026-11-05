import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { createSetupLink, createUser } from "@/lib/services/users";
import { getOperatorAccounts } from "@/lib/services/views";

export const dynamic = "force-dynamic";

const create = z.object({ username: z.string().max(100), displayName: z.string().max(200) });

export const GET = userRoute(() => {
  const { db, config } = ctx();
  return { accounts: getOperatorAccounts(db, { thresholdCents: config.unusualMonthlyTotalCents, factor: config.unusualFactor }) };
}, { operator: true });

/** Neues Konto anlegen; der Einrichtungslink wird nur jetzt angezeigt (gespeichert ist nur ein Hash). */
export const POST = userRoute(async ({ readBody }) => {
  const { db, config } = ctx();
  const input = create.parse(await readBody());
  const id = createUser(db, { username: input.username, displayName: input.displayName });
  return { id, link: `${config.baseUrl}/setup/${createSetupLink(db, id)}` };
}, { operator: true });
