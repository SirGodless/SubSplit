import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/tokens";

export type UnsubscribePurpose = "reminders" | "prices";
const PURPOSES: UnsubscribePurpose[] = ["reminders", "prices"];

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(`unsubscribe:${data}`).digest("base64url");

/** Abmelde-Token ohne Speicherung: signiert mit dem SESSION_SECRET (Konto-ID + Art der Mails). */
export function makeUnsubscribeToken(secret: string, userId: number, purpose: UnsubscribePurpose): string {
  const data = Buffer.from(`${userId}:${purpose}`).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function readUnsubscribeToken(secret: string, token: string): { userId: number; purpose: UnsubscribePurpose } | null {
  const [data, sig, ...rest] = token.split(".");
  if (!data || !sig || rest.length > 0 || !safeEqual(sig, sign(data, secret))) return null;
  const [uid, purpose] = Buffer.from(data, "base64url").toString("utf8").split(":");
  if (!/^\d{1,9}$/.test(uid ?? "") || !PURPOSES.includes(purpose as UnsubscribePurpose)) return null;
  return { userId: Number(uid), purpose: purpose as UnsubscribePurpose };
}
