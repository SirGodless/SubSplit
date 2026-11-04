import { adminRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(({ session }) => ({ csrfToken: session.csrf }));
