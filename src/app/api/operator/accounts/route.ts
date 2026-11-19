import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { getOperatorAccounts } from "@/lib/services/views";

export const dynamic = "force-dynamic";

/** Konten-Übersicht für den Betreiber (Größenklasse und Warnung). Konten selbst verwaltet der Hub. */
export const GET = userRoute(() => {
  const { db, config } = ctx();
  return { accounts: getOperatorAccounts(db, { thresholdCents: config.unusualMonthlyTotalCents, factor: config.unusualFactor }) };
}, { operator: true });
