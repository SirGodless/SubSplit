import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export type AuthFailReason = "invalid_token" | "admin_login";
export type NoticeReason = "revoked_token";

const TIME_ZONE = "Europe/Berlin";

/** ISO-8601 mit Zeitzonen-Offset, z. B. 2026-11-04T13:43:12+01:00 (Europe/Berlin). */
export function formatTimestamp(date: Date, timeZone = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const off = get("timeZoneName"); // "GMT+01:00" oder "GMT"
  const offset = off === "GMT" ? "+00:00" : off.replace("GMT", "");
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

export function formatLine(kind: "AUTHFAIL" | "NOTICE", ip: string, reason: AuthFailReason | NoticeReason, now = new Date()): string {
  // ip kommt ausschließlich aus dem IpResolver (gültige IP oder "unknown"); reason ist ein fester Wert.
  return `${formatTimestamp(now)} SUBSPLIT_${kind} ip=${ip} reason=${reason}`;
}

export interface SecurityLogger {
  authFail(ip: string, reason: AuthFailReason): void;
  notice(ip: string, reason: NoticeReason): void;
}

export interface SecurityLogOptions {
  file: string;
  maxBytes?: number;
  keep?: number;
  stdout?: (line: string) => void;
  now?: () => Date;
}

/** Schreibt je Ereignis genau eine Zeile in die Datei und nach stdout. Rotation nach Größe. */
export function createSecurityLogger(opts: SecurityLogOptions): SecurityLogger {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = opts.keep ?? 3;
  const out = opts.stdout ?? ((l: string) => console.log(l));
  const now = opts.now ?? (() => new Date());

  function rotateIfNeeded() {
    try {
      if (!existsSync(opts.file) || statSync(opts.file).size < maxBytes) return;
      for (let i = keep; i >= 1; i--) {
        const from = i === 1 ? opts.file : `${opts.file}.${i - 1}`;
        const to = `${opts.file}.${i}`;
        if (i === keep && existsSync(to)) unlinkSync(to);
        if (existsSync(from)) renameSync(from, to);
      }
    } catch {
      /* Rotation darf nie die Anfrage zum Scheitern bringen */
    }
  }

  function write(line: string) {
    out(line);
    try {
      mkdirSync(dirname(opts.file), { recursive: true });
      rotateIfNeeded();
      appendFileSync(opts.file, line + "\n", { mode: 0o644 });
    } catch (err) {
      console.error("Sicherheits-Log konnte nicht geschrieben werden:", err instanceof Error ? err.message : "unbekannter Fehler");
    }
  }

  return {
    authFail: (ip, reason) => write(formatLine("AUTHFAIL", ip, reason, now())),
    notice: (ip, reason) => write(formatLine("NOTICE", ip, reason, now())),
  };
}
