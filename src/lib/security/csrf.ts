import { safeEqual } from "./tokens";

/**
 * CSRF-Schutz für zustandsändernde Anfragen:
 *  - Origin (falls gesendet) muss zu BASE_URL passen,
 *  - bei Admin-Anfragen zusätzlich Header x-csrf-token == Token aus der Session.
 */
export function isSameOrigin(originHeader: string | null, baseUrl: string): boolean {
  if (originHeader === null) return true; // ältere/nicht-Browser-Clients; Cookie ist SameSite=Strict
  try {
    return new URL(originHeader).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function csrfTokenValid(headerValue: string | null, sessionCsrf: string): boolean {
  return !!headerValue && safeEqual(headerValue, sessionCsrf);
}
