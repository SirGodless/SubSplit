"use client";
import { api, setCsrf } from "@/lib/client/api";

export default function LogoutButton() {
  async function logout() {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      /* Sitzung war schon weg */
    }
    setCsrf(null);
    window.location.href = "/login";
  }
  return <button type="button" className="btn btn--small" onClick={logout}>Abmelden</button>;
}
