import { describe, expect, it } from "vitest";
import { allocate } from "@/lib/billing/allocate";
import { computeMonth, priceForMonth, type SubscriptionInput } from "@/lib/billing/compute";
import { addMonths, currentMonth } from "@/lib/billing/month";
import { REFERENCE_ALPHABET, generateReferenceId, generateUniqueReferenceId } from "@/lib/billing/reference";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("allocate (Largest-Remainder)", () => {
  it("verteilt 1000 Cent auf 3 gleiche Teile als 334/333/333, Zusatzcent nach kleinster ID", () => {
    const r = allocate(1000, [3, 1, 2].map((id) => ({ participantId: id, weight: 1 })));
    expect(r.map((x) => [x.participantId, x.amountCents])).toEqual([[1, 334], [2, 333], [3, 333]]);
  });
  it("berücksichtigt Gewichte (Beispiel 1799 Cent, 2:1; Cent geht an größeren Rest)", () => {
    const r = allocate(1799, [{ participantId: 1, weight: 2 }, { participantId: 2, weight: 1 }]);
    expect(r.map((x) => x.amountCents)).toEqual([1199, 600]);
  });
  it("Rest entscheidet vor ID (größerer Rest bekommt den Cent)", () => {
    // 100 * [1,2] / 3 -> 33.33 und 66.67: Rest 1/3 vs 2/3 -> ID 2 bekommt den Cent
    const r = allocate(100, [{ participantId: 1, weight: 1 }, { participantId: 2, weight: 2 }]);
    expect(r.map((x) => x.amountCents)).toEqual([33, 67]);
  });
  it("Preis 0 und einzelner Teilnehmer", () => {
    expect(allocate(0, [{ participantId: 1, weight: 5 }])[0]!.amountCents).toBe(0);
    expect(allocate(999, [{ participantId: 1, weight: 5 }])[0]!.amountCents).toBe(999);
    expect(allocate(500, [])).toEqual([]);
  });
  it("lehnt ungültige Eingaben ab", () => {
    expect(() => allocate(10.5, [{ participantId: 1, weight: 1 }])).toThrow();
    expect(() => allocate(-1, [{ participantId: 1, weight: 1 }])).toThrow();
    expect(() => allocate(100, [{ participantId: 1, weight: 0 }])).toThrow();
    expect(() => allocate(100, [{ participantId: 1, weight: 1.5 }])).toThrow();
    expect(() => allocate(100, [{ participantId: 1, weight: 1 }, { participantId: 1, weight: 1 }])).toThrow();
  });
  it("Summe der Anteile == Preis, bei 5000 zufälligen Fällen; Anteile weichen < 1 Cent vom Ideal ab", () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 5000; i++) {
      const price = Math.floor(rnd() * 100000);
      const n = 1 + Math.floor(rnd() * 12);
      const members = Array.from({ length: n }, (_, k) => ({ participantId: k + 1, weight: 1 + Math.floor(rnd() * 10) }));
      const result = allocate(price, members);
      expect(result.reduce((s, x) => s + x.amountCents, 0)).toBe(price);
      const W = members.reduce((s, m) => s + m.weight, 0);
      for (const x of result) {
        expect(Math.abs(x.amountCents - (price * x.weight) / W)).toBeLessThan(1);
        expect(Number.isInteger(x.amountCents)).toBe(true);
      }
    }
  });
  it("ist unabhängig von der Eingabereihenfolge", () => {
    const a = [{ participantId: 1, weight: 1 }, { participantId: 2, weight: 1 }, { participantId: 3, weight: 1 }];
    expect(allocate(100, a)).toEqual(allocate(100, [...a].reverse()));
  });
});

describe("Monate", () => {
  it("addMonths über Jahresgrenzen", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 14)).toBe("2028-01");
  });
  it("currentMonth nutzt Europe/Berlin, nicht UTC", () => {
    expect(currentMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(currentMonth(new Date("2026-10-31T23:30:00Z"), "UTC")).toBe("2026-10");
  });
});

describe("Preishistorie", () => {
  const prices = [
    { validFromMonth: "2025-01", amountCents: 1299 },
    { validFromMonth: "2026-03", amountCents: 1599 },
  ];
  it("liefert den Preis, der im Monat galt", () => {
    expect(priceForMonth(prices, "2024-12")).toBeNull();
    expect(priceForMonth(prices, "2025-01")).toBe(1299);
    expect(priceForMonth(prices, "2026-02")).toBe(1299);
    expect(priceForMonth(prices, "2026-03")).toBe(1599);
    expect(priceForMonth(prices, "2030-01")).toBe(1599);
  });
  it("Preiserhöhung verändert vergangene Monate nicht", () => {
    const sub: SubscriptionInput = {
      id: 1, name: "S", prices,
      memberships: [{ participantId: 1, weight: 1, validFromMonth: "2025-01", validToMonth: null }],
    };
    const ps = [{ id: 1, displayName: "A", isOwner: false }];
    expect(computeMonth("2026-02", [sub], ps).totals[0]!.totalCents).toBe(1299);
    expect(computeMonth("2026-03", [sub], ps).totals[0]!.totalCents).toBe(1599);
  });
});

describe("computeMonth", () => {
  const participants = [
    { id: 1, displayName: "Ich", isOwner: true },
    { id: 2, displayName: "Anna", isOwner: false },
    { id: 3, displayName: "Bob", isOwner: false },
    { id: 4, displayName: "Cleo", isOwner: false },
  ];
  const m = (participantId: number, weight = 1, from = "2026-01", to: string | null = null) => ({
    participantId, weight, validFromMonth: from, validToMonth: to,
  });
  const subs: SubscriptionInput[] = [
    { id: 10, name: "Netflix", prices: [{ validFromMonth: "2026-01", amountCents: 1999 }], memberships: [m(1), m(2), m(3)] },
    { id: 20, name: "Spotify", prices: [{ validFromMonth: "2026-01", amountCents: 1700 }], memberships: [m(2, 2), m(3, 1)] },
    { id: 30, name: "Cloud", prices: [{ validFromMonth: "2026-01", amountCents: 300 }], memberships: [m(4)] },
  ];

  it("Monatssumme = Summe der gerundeten Anteile über mehrere Abos", () => {
    const r = computeMonth("2026-05", subs, participants);
    const nf = r.subscriptions.find((s) => s.subscriptionId === 10)!;
    expect(nf.lines.map((l) => l.amountCents)).toEqual([667, 666, 666]); // 1999 / 3, Zusatzcent -> ID 1
    const sp = r.subscriptions.find((s) => s.subscriptionId === 20)!;
    expect(sp.lines.map((l) => l.amountCents)).toEqual([1133, 567]); // 1700*2/3 = 1133.33, 1700/3 = 566.67
    const total = (id: number) => r.totals.find((t) => t.participantId === id)!.totalCents;
    expect(total(2)).toBe(666 + 1133);
    expect(total(3)).toBe(666 + 567);
    expect(total(4)).toBe(300);
    // Gesamtsumme aller Anteile == Summe aller Abo-Preise
    expect(r.totals.reduce((s, t) => s + t.totalCents, 0)).toBe(1999 + 1700 + 300);
  });

  it("Owner-Anteil wird berechnet, aber nicht als Zahlung geführt", () => {
    const r = computeMonth("2026-05", subs, participants);
    const owner = r.totals.find((t) => t.participantId === 1)!;
    expect(owner.totalCents).toBe(667);
    expect(owner.payable).toBe(false);
    expect(r.totals.filter((t) => t.payable).map((t) => t.participantId)).toEqual([2, 3, 4]);
  });

  it("Beteiligung gilt nur im Zeitraum (Hinzufügen/Entfernen wirkt monatsgenau)", () => {
    const s: SubscriptionInput[] = [{
      id: 1, name: "X", prices: [{ validFromMonth: "2026-01", amountCents: 1000 }],
      memberships: [m(2, 1, "2026-01"), m(3, 1, "2026-06", "2026-08")],
    }];
    const lines = (month: string) => computeMonth(month, s, participants).subscriptions[0]!.lines.map((l) => l.participantId);
    expect(lines("2026-05")).toEqual([2]);
    expect(lines("2026-06")).toEqual([2, 3]);
    expect(lines("2026-08")).toEqual([2, 3]);
    expect(lines("2026-09")).toEqual([2]);
  });

  it("Prozentwerte sind Anzeige und stammen aus den Gewichten", () => {
    const r = computeMonth("2026-05", subs, participants);
    const sp = r.subscriptions.find((s) => s.subscriptionId === 20)!;
    expect(sp.lines.map((l) => l.percent)).toEqual([66.67, 33.33]);
  });

  it("Abos ohne gültigen Preis oder ohne Beteiligte tauchen nicht auf; Teilnehmer ohne Abo nicht in totals", () => {
    const r = computeMonth("2025-12", subs, participants);
    expect(r.subscriptions).toEqual([]);
    expect(r.totals).toEqual([]);
  });

  it("Zahlung 0 ist nicht payable", () => {
    const s: SubscriptionInput[] = [{ id: 1, name: "Gratis", prices: [{ validFromMonth: "2026-01", amountCents: 0 }], memberships: [m(2)] }];
    expect(computeMonth("2026-05", s, participants).totals[0]!.payable).toBe(false);
  });
});

describe("Referenz-ID", () => {
  it("hat 6 Zeichen aus dem Alphabet ohne verwechselbare Zeichen", () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[O0I1l]/);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(REFERENCE_ALPHABET.length);
    for (let i = 0; i < 500; i++) expect(generateReferenceId()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it("ist eindeutig: bei Kollision wird neu gewürfelt, 20000 IDs ohne Dopplung", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const id = generateUniqueReferenceId((x) => taken.has(x));
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    // Erzwungene Kollision: erste zwei Würfe liefern bereits vergebene ID
    let call = 0;
    const rand = () => (call++ < 12 ? 0 : 1);
    const used = new Set(["AAAAAA"]);
    expect(generateUniqueReferenceId((x) => used.has(x), rand)).toBe("BBBBBB");
  });
});
