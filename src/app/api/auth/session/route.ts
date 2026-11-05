import { userRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Liefert das CSRF-Token und verlängert die Sitzung (auch als "Keep-Alive" bei Aktivität genutzt). */
export const GET = userRoute(({ user, session }) => ({
  csrfToken: session.csrf,
  user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
}));
