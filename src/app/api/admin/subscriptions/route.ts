import { z } from "zod";
import { memberships, subscriptionPrices, subscriptions } from "@/db/schema";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { createSubscription, earliestChangeMonth } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const create = z.object({ name: z.string(), priceCents: z.number().int(), validFromMonth: month });

export const GET = adminRoute(() => {
  const { db } = ctx();
  return {
    subscriptions: db.select().from(subscriptions).all(),
    prices: db.select().from(subscriptionPrices).all(),
    memberships: db.select().from(memberships).all(),
    earliestChangeMonth: earliestChangeMonth(db),
  };
});

export const POST = adminRoute(async ({ readBody }) => {
  const input = create.parse(await readBody());
  return { id: createSubscription(ctx().db, input) };
});
