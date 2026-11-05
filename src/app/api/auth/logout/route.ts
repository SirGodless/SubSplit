import { clearSessionCookie } from "@/lib/security/session";
import { secureCookies } from "@/lib/server/context";
import { json, userRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = userRoute(() => json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secureCookies()) }));
