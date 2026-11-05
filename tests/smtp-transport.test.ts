import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import type { MailConfig } from "@/lib/config";
import { createSmtpTransport } from "@/lib/mail/transport";

let servers: SMTPServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers = [];
});

interface Received { raw: string; from: string; to: string[] }

/** Startet einen lokalen SMTP-Server (optional ohne STARTTLS, optional mit TLS von Anfang an) und sammelt die Mails. */
function startServer(opts: { starttls: boolean; implicitTls?: boolean }): Promise<{ port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: opts.starttls ? [] : ["STARTTLS"],
    secure: !!opts.implicitTls,
    logger: false,
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({ raw: Buffer.concat(chunks).toString("utf8"), from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address) });
        cb();
      });
    },
  });
  server.on("error", () => {}); // erwartet: der Client lehnt das selbstsignierte Zertifikat absichtlich ab
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.server.address() as { port: number }).port, received })));
}

const cfg = (port: number, security: MailConfig["security"]): MailConfig => ({
  host: "127.0.0.1", port, security, user: null, password: null, from: "SubSplit <noreply@anfall.net>", fromAddress: "noreply@anfall.net",
});
const mail = { to: "anna@example.org", subject: "Erinnerung", text: "Hallo Anna\n", unsubscribeUrl: "https://abos.example.org/api/unsubscribe/abc.def" };

describe("SMTP-Versand gegen einen echten lokalen Server", () => {
  it("internal: funktioniert mit reinem SMTP ohne STARTTLS", async () => {
    const s = await startServer({ starttls: false });
    await createSmtpTransport(cfg(s.port, "internal")).send(mail);
    expect(s.received).toHaveLength(1);
    expect(s.received[0]).toMatchObject({ from: "noreply@anfall.net", to: ["anna@example.org"] });
  });
  it("internal: funktioniert auch mit STARTTLS und selbstsigniertem Zertifikat (Container im eigenen Docker-Netz)", async () => {
    const s = await startServer({ starttls: true });
    const t = createSmtpTransport(cfg(s.port, "internal"));
    await t.verify();
    await t.send(mail);
    expect(s.received).toHaveLength(1);
  });
  it("starttls: prüft das Zertifikat und erzwingt TLS (selbstsigniert wird abgelehnt, fehlendes STARTTLS auch)", async () => {
    const selfSigned = await startServer({ starttls: true });
    await expect(createSmtpTransport(cfg(selfSigned.port, "starttls")).send(mail)).rejects.toThrow();
    const plain = await startServer({ starttls: false });
    await expect(createSmtpTransport(cfg(plain.port, "starttls")).send(mail)).rejects.toThrow();
    expect(selfSigned.received.length + plain.received.length).toBe(0); // nichts im Klartext oder unverifiziert verschickt
  });
  it("tls: TLS von Anfang an mit Zertifikatsprüfung (selbstsigniert wird abgelehnt)", async () => {
    const s = await startServer({ starttls: false, implicitTls: true });
    await expect(createSmtpTransport(cfg(s.port, "tls")).send(mail)).rejects.toThrow();
    expect(s.received).toHaveLength(0);
  });
  it("Header: Absender, List-Unsubscribe mit One-Click, Auto-Submitted; kein Reply-To; Inhalt als Klartext", async () => {
    const s = await startServer({ starttls: false });
    await createSmtpTransport(cfg(s.port, "internal")).send(mail);
    const raw = s.received[0]!.raw;
    expect(raw).toMatch(/^From: SubSplit <noreply@anfall\.net>/m);
    expect(raw).toMatch(/^To: anna@example\.org/m);
    expect(raw).toMatch(/^Subject: Erinnerung/m);
    expect(raw).toMatch(/^List-Unsubscribe: <https:\/\/abos\.example\.org\/api\/unsubscribe\/abc\.def>/m);
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    expect(raw).toMatch(/^Auto-Submitted: auto-generated/m);
    expect(raw).not.toMatch(/^Reply-To:/m);
    expect(raw).toContain("Hallo Anna");
    expect(raw).toMatch(/Content-Type: text\/plain/);
  });
  it("ohne Abmelde-Link keine List-Unsubscribe-Header (Bestätigungs- und Test-Mail)", async () => {
    const s = await startServer({ starttls: false });
    await createSmtpTransport(cfg(s.port, "internal")).send({ ...mail, unsubscribeUrl: null });
    expect(s.received[0]!.raw).not.toMatch(/List-Unsubscribe/i);
  });
  it("nicht erreichbarer Server: Fehler statt Hängen", async () => {
    const t = createSmtpTransport(cfg(1, "internal"));
    await expect(t.send(mail)).rejects.toThrow();
  });
});
