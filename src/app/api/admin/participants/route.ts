import { z } from "zod";
import { participants } from "@/db/schema";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { createParticipant } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const create = z.object({ displayName: z.string(), email: z.string().nullable().optional(), isOwner: z.boolean().optional() });

export const GET = adminRoute(() =>
  // Bewusst ohne tokenHash: Der Admin sieht Links nur einmal bei Erzeugung/Neuerzeugung.
  ({
    participants: ctx()
      .db.select({
        id: participants.id,
        displayName: participants.displayName,
        email: participants.email,
        isOwner: participants.isOwner,
        remindersEnabled: participants.remindersEnabled,
        tokenRevokedAt: participants.tokenRevokedAt,
      })
      .from(participants)
      .all(),
  }),
);

export const POST = adminRoute(async ({ readBody }) => {
  const c = ctx();
  const { id, token } = createParticipant(c.db, create.parse(await readBody()));
  return { id, link: `${c.config.baseUrl}/p/${token}` };
});
