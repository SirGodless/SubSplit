import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { createSubscription } from "@/lib/services/manage";
import { getManageData } from "@/lib/services/views";

export const dynamic = "force-dynamic";

const create = z.object({ name: z.string().max(200), priceCents: z.number().int(), validFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const GET = userRoute(({ user }) => getManageData(ctx().db, user));

export const POST = userRoute(async ({ user, readBody }) => ({ id: createSubscription(ctx().db, user.id, create.parse(await readBody())) }));
