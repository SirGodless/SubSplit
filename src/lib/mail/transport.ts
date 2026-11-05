import nodemailer from "nodemailer";
import type { MailConfig } from "@/lib/config";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  /** Link für den One-Click-Abmelde-Header (RFC 8058). */
  unsubscribeUrl?: string | null;
}

/** Abstraktion des Versands, damit Tests ohne Netzwerk auskommen. */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
  /** Verbindung prüfen (nur für das Startlog). */
  verify(): Promise<void>;
}

export function createSmtpTransport(cfg: MailConfig): MailTransport {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.security === "tls",
    requireTLS: cfg.security === "starttls",
    // internal: TLS wenn angeboten, aber ohne Zertifikatsprüfung (Container im eigenen Docker-Netz)
    ...(cfg.security === "internal" ? { tls: { rejectUnauthorized: false } } : {}),
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async send(mail) {
      await transporter.sendMail({
        from: cfg.from,
        envelope: { from: cfg.fromAddress, to: mail.to },
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        headers: {
          "Auto-Submitted": "auto-generated",
          "X-Auto-Response-Suppress": "All",
          ...(mail.unsubscribeUrl ? { "List-Unsubscribe": `<${mail.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
        },
      });
    },
    async verify() {
      await transporter.verify();
    },
  };
}
