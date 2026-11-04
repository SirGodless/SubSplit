import { clearSessionCookie } from "@/lib/security/session";
import { ctx } from "@/lib/server/context";
import { adminRoute, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = adminRoute(() => json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(ctx().config.baseUrl.startsWith("https:")) }));
