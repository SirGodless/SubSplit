import { BlockList, isIP } from "node:net";

/** Header, den der Peer-Hook (instrumentation-node.ts) für jede Anfrage selbst setzt – Clientwerte werden überschrieben. */
export const PEER_HEADER = "x-subsplit-peer";

export type IpResolver = (peer: string | null | undefined, xForwardedFor: string | null | undefined) => string;

/** Normalisiert ::ffff:1.2.3.4 zu 1.2.3.4 und prüft, ob es eine gültige IP ist. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v);
  if (mapped) v = mapped[1]!;
  return isIP(v) ? v.toLowerCase() : null;
}

/**
 * Baut den Resolver: X-Forwarded-For zählt nur, wenn die direkte Verbindung aus den vertrauenswürdigen
 * Netzen kommt. Dann wird die Kette von rechts durchlaufen; der erste Eintrag, der selbst kein
 * vertrauenswürdiger Proxy ist, gilt als Client. Ist keine gültige IP bestimmbar -> "unknown".
 */
export function createIpResolver(trustedCidrs: string[]): IpResolver {
  const trusted = new BlockList();
  for (const cidr of trustedCidrs) {
    const [addr, prefix] = cidr.split("/") as [string, string];
    trusted.addSubnet(addr, Number(prefix), isIP(addr) === 4 ? "ipv4" : "ipv6");
  }
  const isTrusted = (ip: string) => trusted.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");

  return (peerRaw, xff) => {
    const peer = normalizeIp(peerRaw);
    if (!peer) return "unknown";
    if (!isTrusted(peer)) return peer; // Direktverbindung: Header ignorieren
    if (!xff) return "unknown"; // Proxy ohne Weiterleitungsangabe: nie den Proxy selbst melden
    const chain = xff.split(",").map((s) => s.trim()).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) {
      const ip = normalizeIp(chain[i]);
      if (!ip) return "unknown"; // Müll in der Kette: lieber nichts melden als falsche Adresse
      if (!isTrusted(ip)) return ip;
    }
    return "unknown";
  };
}
