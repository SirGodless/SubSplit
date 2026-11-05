import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, payments, standingOrders, subscriptionPrices, subscriptions, users } from "@/db/schema";
import { addMonths, assertMonth, berlinDate, currentMonth, dueDateOf, type Month } from "@/lib/billing/month";
import { AppError } from "./errors";
import { endMembershipFrom } from "./manage";
import { getStandingOrder } from "./standing-orders";
import { computeOwnerMonth, ensureOwnerPayments, firstBillingMonth, firstStartMonthForNew, nextChangeMonth, type PaymentStatus } from "./payments";

/** Wie viele Monate der Verlauf der Empfänger-Übersicht zeigt. */
export const HISTORY_MONTHS = 12;

// =====================================================================================
// Austragen
// =====================================================================================

export interface LeavePlan {
  /** Erster Monat, für den die Person NICHT mehr zahlt: immer der Folgemonat. */
  effectiveMonth: Month;
}

/**
 * Austragen gilt immer ab dem Folgemonat: Der laufende Monat bleibt zu zahlen, die Beträge der anderen im
 * laufenden Monat ändern sich nicht. Rückstände aus Vormonaten bleiben bestehen.
 */
export function planLeave(db: Db, subscriptionId: number, now: Date = new Date()): LeavePlan {
  if (!db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).get()) throw new AppError("not_found", "Abo nicht gefunden.");
  return { effectiveMonth: addMonths(currentMonth(now), 1) };
}

/** Trägt den Benutzer aus dem Abo aus (Wirkung siehe planLeave). */
export function leaveSubscription(db: Db, userId: number, subscriptionId: number, now: Date = new Date()): LeavePlan {
  const mine = db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.subscriptionId, subscriptionId), eq(memberships.userId, userId))).get();
  if (!mine) throw new AppError("not_found", "Du bist an diesem Abo nicht beteiligt.");
  const plan = planLeave(db, subscriptionId, now);
  const stillIn = db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.subscriptionId, subscriptionId), eq(memberships.userId, userId), or(isNull(memberships.validToMonth), gt(memberships.validToMonth, addMonths(plan.effectiveMonth, -1)))))
    .get();
  if (!stillIn) throw new AppError("invalid", "Du bist bereits ausgetragen.");
  endMembershipFrom(db, subscriptionId, userId, addMonths(plan.effectiveMonth, -1), now);
  return plan;
}

// =====================================================================================
// Startseite des Zahlers
// =====================================================================================

export interface HomePayment {
  recipientId: number;
  recipientName: string;
  outstandingCents: number;
  /** Davon Rückstand aus Vormonaten. */
  arrearsCents: number;
  /** Bezahlt gemeldet, noch nicht bestätigt. */
  reportedCents: number;
  /** Per Dauerauftrag erwartet: wird am Fälligkeitstag automatisch bestätigt, nichts zu überweisen. */
  expectedCents: number;
  standingOrder: boolean;
  months: Array<{ month: Month; amountCents: number; status: PaymentStatus }>;
  dueDate: string;
}
export interface HomeSubscription {
  id: number;
  name: string;
  ownerName: string;
  weight: number;
  from: Month;
  to: Month | null;
  state: "active" | "upcoming" | "ending";
  leave: LeavePlan | null;
}
export interface HomeView {
  displayName: string;
  month: Month;
  totalOutstandingCents: number;
  totalReportedCents: number;
  payments: HomePayment[];
  subscriptions: HomeSubscription[];
}

/** Startseite: offene Zahlungen pro Empfänger (inkl. Rückstand) mit Gesamtsumme und die eigenen Abos. */
export function getHome(db: Db, userId: number, now: Date = new Date()): HomeView | null {
  const me = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).get();
  if (!me) return null;
  const cur = currentMonth(now);

  const mem = db
    .select({
      id: subscriptions.id, name: subscriptions.name, ownerId: subscriptions.ownerUserId, ownerName: users.displayName,
      weight: memberships.weight, from: memberships.validFromMonth, to: memberships.validToMonth,
    })
    .from(memberships)
    .innerJoin(subscriptions, eq(subscriptions.id, memberships.subscriptionId))
    .innerJoin(users, eq(users.id, subscriptions.ownerUserId))
    .where(and(eq(memberships.userId, userId), or(isNull(memberships.validToMonth), gt(memberships.validToMonth, addMonths(cur, -1)))))
    .all();
  for (const ownerId of new Set(mem.map((m) => m.ownerId))) ensureOwnerPayments(db, ownerId, now);

  const rows = db
    .select({ p: payments, recipientName: users.displayName, dueDay: users.dueDay })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.recipientUserId))
    .where(and(eq(payments.payerUserId, userId), lte(payments.month, cur), inArray(payments.status, ["open", "marked_paid"])))
    .orderBy(payments.month)
    .all();
  const orders = new Map(db.select().from(standingOrders).where(eq(standingOrders.payerUserId, userId)).all().map((o) => [o.recipientUserId, o.fromMonth]));
  const byRecipient = new Map<number, HomePayment>();
  for (const r of rows) {
    const so = orders.get(r.p.recipientUserId);
    const h = byRecipient.get(r.p.recipientUserId) ?? {
      recipientId: r.p.recipientUserId, recipientName: r.recipientName, outstandingCents: 0, arrearsCents: 0, reportedCents: 0, expectedCents: 0, standingOrder: so !== undefined, months: [], dueDate: dueDateOf(cur, r.dueDay),
    };
    byRecipient.set(r.p.recipientUserId, h);
    if (r.p.status === "open" && so !== undefined && r.p.month >= so) {
      h.expectedCents += r.p.amountCents; // deckt der Dauerauftrag ab
      continue;
    }
    h.months.push({ month: r.p.month, amountCents: r.p.amountCents, status: r.p.status });
    if (r.p.status === "open") {
      h.outstandingCents += r.p.amountCents;
      if (r.p.month < cur) h.arrearsCents += r.p.amountCents;
    } else h.reportedCents += r.p.amountCents;
    byRecipient.set(r.p.recipientUserId, h);
  }
  const list = [...byRecipient.values()].sort((a, b) => a.recipientName.localeCompare(b.recipientName, "de"));

  const subs: HomeSubscription[] = mem
    .map((m) => ({
      id: m.id, name: m.name, ownerName: m.ownerName, weight: m.weight, from: m.from, to: m.to,
      state: (m.from > cur ? "upcoming" : m.to !== null ? "ending" : "active") as HomeSubscription["state"],
      leave: m.to === null || m.to >= cur ? planLeave(db, m.id, now) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return {
    displayName: me.displayName,
    month: cur,
    totalOutstandingCents: list.reduce((s, p) => s + p.outstandingCents, 0),
    totalReportedCents: list.reduce((s, p) => s + p.reportedCents, 0),
    payments: list,
    subscriptions: subs,
  };
}

// =====================================================================================
// Zahlungsansicht eines Zahlers bei einem Empfänger
// =====================================================================================

/**
 * Was ein Zahler sehen darf – und NUR das: eigene Beträge, die Abos DIESES Empfängers, an denen er beteiligt ist,
 * dort Anzeigenamen/Gewichte/Anteile/Beträge der Mitzahler. Keine E-Mails, keine Benutzernamen, keine fremden
 * Referenz-IDs, Status oder Summen, keine anderen Abos.
 */
export interface PayerView {
  recipient: { id: number; displayName: string };
  /** Zahlungsdaten des Empfängers (nur, wenn der Zahler dort etwas schuldet oder beteiligt ist). */
  recipientPay: { name: string; iban: string | null; paypalMe: string | null };
  month: Month;
  months: Month[];
  /** Eigener Gesamtanteil im gewählten Monat. */
  totalCents: number;
  dueDate: string;
  /** Was jetzt zu überweisen ist: laufender Monat plus Rückstand, jeweils noch offen. */
  outstanding: {
    totalCents: number;
    items: Array<{ month: Month; amountCents: number }>;
    /** Referenz-ID der neuesten offenen Zahlung (steht im Verwendungszweck). */
    referenceId: string | null;
    referenceMonth: Month | null;
    hasArrears: boolean;
  };
  reportedCents: number;
  /** Dauerauftrag zwischen diesem Zahler und dem Empfänger (null = aus). Beide Seiten dürfen ihn setzen. */
  standingOrder: { fromMonth: Month } | null;
  /** Vom Dauerauftrag abgedeckt: nichts zu überweisen, wird am Fälligkeitstag automatisch bestätigt. */
  expected: { totalCents: number; items: Array<{ month: Month; amountCents: number }> };
  payment: { referenceId: string; status: PaymentStatus; amountCents: number } | null;
  subscriptions: Array<{
    name: string;
    priceCents: number;
    restCents: number;
    lines: Array<{ displayName: string; weight: number; percent: number; amountCents: number; isYou: boolean }>;
  }>;
}

export function getPayerView(db: Db, payerId: number, recipientId: number, requestedMonth?: string, now: Date = new Date()): PayerView | null {
  const cur = currentMonth(now);
  const month = requestedMonth ?? cur;
  assertMonth(month);
  const recipient = db.select().from(users).where(eq(users.id, recipientId)).get();
  if (!recipient || recipientId === payerId) return null;

  const relation =
    db.select({ id: memberships.id }).from(memberships).innerJoin(subscriptions, eq(subscriptions.id, memberships.subscriptionId))
      .where(and(eq(memberships.userId, payerId), eq(subscriptions.ownerUserId, recipientId))).get() ??
    db.select({ id: payments.id }).from(payments).where(and(eq(payments.payerUserId, payerId), eq(payments.recipientUserId, recipientId))).get();
  if (!relation) return null;

  ensureOwnerPayments(db, recipientId, now);
  const own = db.select().from(payments).where(and(eq(payments.payerUserId, payerId), eq(payments.recipientUserId, recipientId), lte(payments.month, cur))).orderBy(payments.month).all();
  const months = [...new Set([cur, ...own.map((p) => p.month)])].sort().reverse();
  if (!months.includes(month)) return null;

  const result = computeOwnerMonth(db, recipientId, month);
  const names = new Map(
    db.select({ id: users.id, displayName: users.displayName }).from(users)
      .where(inArray(users.id, [...new Set(result.subscriptions.flatMap((s) => s.lines.map((l) => l.participantId)))].concat([payerId]))).all()
      .map((u) => [u.id, u.displayName]),
  );
  const subs = result.subscriptions
    .filter((s) => s.lines.some((l) => l.participantId === payerId))
    .map((s) => ({
      name: s.name,
      priceCents: s.priceCents,
      restCents: s.restCents,
      lines: s.lines.map((l) => ({ displayName: names.get(l.participantId) ?? "?", weight: l.weight, percent: l.percent, amountCents: l.amountCents, isYou: l.participantId === payerId })),
    }));

  const so = getStandingOrder(db, payerId, recipientId);
  const covered = (p: { month: string }) => !!so && p.month >= so.fromMonth;
  const openAll = own.filter((p) => p.status === "open");
  const open = openAll.filter((p) => !covered(p));
  const expected = openAll.filter(covered);
  const newest = open[open.length - 1];
  const thisMonth = own.find((p) => p.month === month);
  return {
    recipient: { id: recipient.id, displayName: recipient.displayName },
    recipientPay: { name: recipient.recipientName ?? recipient.displayName, iban: recipient.iban, paypalMe: recipient.paypalMe },
    month,
    months,
    totalCents: result.totals.find((t) => t.participantId === payerId)?.totalCents ?? 0,
    dueDate: dueDateOf(month, recipient.dueDay),
    outstanding: {
      totalCents: open.reduce((s, p) => s + p.amountCents, 0),
      items: open.map((p) => ({ month: p.month, amountCents: p.amountCents })),
      referenceId: newest?.referenceId ?? null,
      referenceMonth: newest?.month ?? null,
      hasArrears: open.some((p) => p.month < cur),
    },
    reportedCents: own.filter((p) => p.status === "marked_paid").reduce((s, p) => s + p.amountCents, 0),
    standingOrder: so,
    expected: { totalCents: expected.reduce((s, p) => s + p.amountCents, 0), items: expected.map((p) => ({ month: p.month, amountCents: p.amountCents })) },
    payment: thisMonth ? { referenceId: thisMonth.referenceId, status: thisMonth.status, amountCents: thisMonth.amountCents } : null,
    subscriptions: subs,
  };
}

// =====================================================================================
// Übersicht des Empfängers (inkl. Gesamtkosten und Verlauf)
// =====================================================================================

export interface OwnerMonthTotals {
  /** Was alle Abos dieses Monats zusammen kosten. */
  totalCostCents: number;
  /** Davon von Mitzahlern geschuldet (Summe der Monatszahlungen). */
  dueCents: number;
  confirmedCents: number;
  reportedCents: number;
  openCents: number;
  /** Dein eigener Anteil inklusive Rundungsrest. totalCost = due + ownShare. */
  ownShareCents: number;
}
export interface OwnerOverview {
  month: Month;
  totals: OwnerMonthTotals;
  payments: Array<{
    paymentId: number; payerId: number; payerName: string; referenceId: string; amountCents: number; status: PaymentStatus; arrearsCents: number;
    /** Dauerauftrag dieses Zahlers (Startmonat) bzw. null. */
    standingOrder: Month | null;
    /** Diese Zahlung wurde automatisch per Dauerauftrag bestätigt. */
    viaStandingOrder: boolean;
  }>;
  subscriptions: Array<{ subscriptionId: number; name: string; priceCents: number; restCents: number }>;
  history: Array<OwnerMonthTotals & { month: Month }>;
}

function monthTotals(db: Db, ownerId: number, month: Month): { totals: OwnerMonthTotals; result: ReturnType<typeof computeOwnerMonth> } {
  const result = computeOwnerMonth(db, ownerId, month);
  const rows = db.select().from(payments).where(and(eq(payments.recipientUserId, ownerId), eq(payments.month, month))).all();
  const sum = (st?: PaymentStatus) => rows.filter((r) => !st || r.status === st).reduce((s, r) => s + r.amountCents, 0);
  const due = sum();
  const ownTotal = result.totals.find((t) => t.isOwner)?.totalCents ?? 0;
  return {
    result,
    totals: {
      totalCostCents: result.totalCostCents,
      dueCents: due,
      confirmedCents: sum("confirmed"),
      reportedCents: sum("marked_paid"),
      openCents: sum("open"),
      ownShareCents: ownTotal + result.restCents,
    },
  };
}

export function getOwnerOverview(db: Db, ownerId: number, requestedMonth?: string, now: Date = new Date()): OwnerOverview {
  const cur = currentMonth(now);
  const month = requestedMonth ?? cur;
  assertMonth(month);
  if (month > cur) throw new AppError("invalid", "Zukünftige Monate werden nicht abgerechnet.");
  ensureOwnerPayments(db, ownerId, now);
  const { totals, result } = monthTotals(db, ownerId, month);

  const rows = db
    .select({ p: payments, payerName: users.displayName })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.payerUserId))
    .where(and(eq(payments.recipientUserId, ownerId), eq(payments.month, month)))
    .orderBy(users.displayName)
    .all();
  const older = db
    .select({ payer: payments.payerUserId, amount: payments.amountCents })
    .from(payments)
    .where(and(eq(payments.recipientUserId, ownerId), eq(payments.status, "open"), lte(payments.month, addMonths(month, -1))))
    .all();
  const arrears = new Map<number, number>();
  for (const o of older) arrears.set(o.payer, (arrears.get(o.payer) ?? 0) + o.amount);

  const ownerOrders = new Map(db.select().from(standingOrders).where(eq(standingOrders.recipientUserId, ownerId)).all().map((o) => [o.payerUserId, o.fromMonth]));
  const first = firstBillingMonth(db, ownerId);
  const history: OwnerOverview["history"] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const m = addMonths(cur, -i);
    if (!first || m < first) continue;
    history.push({ month: m, ...monthTotals(db, ownerId, m).totals });
  }

  return {
    month,
    totals,
    payments: rows.map((r) => ({
      paymentId: r.p.id, payerId: r.p.payerUserId, payerName: r.payerName, referenceId: r.p.referenceId, amountCents: r.p.amountCents, status: r.p.status,
      arrearsCents: r.p.status === "open" ? (arrears.get(r.p.payerUserId) ?? 0) : 0,
      standingOrder: ownerOrders.get(r.p.payerUserId) ?? null,
      viaStandingOrder: r.p.standingOrderState === "auto",
    })),
    subscriptions: result.subscriptions.map((s) => ({ subscriptionId: s.subscriptionId, name: s.name, priceCents: s.priceCents, restCents: s.restCents })),
    history,
  };
}

// =====================================================================================
// Betreiber-Sicht: Konten mit Größenklasse und Warnung, ohne Beträge und ohne Teilnehmer
// =====================================================================================

export type VolumeClass = "none" | "lt100" | "100to300" | "300to1000" | "gt1000";
export interface OperatorAccount {
  id: number;
  username: string;
  displayName: string;
  role: "operator" | "user";
  status: "invited" | "active" | "disabled";
  volumeClass: VolumeClass;
  warning: null | "threshold" | "jump";
}

export function volumeClassOf(cents: number): VolumeClass {
  if (cents <= 0) return "none";
  if (cents < 10_000) return "lt100";
  if (cents < 30_000) return "100to300";
  if (cents < 100_000) return "300to1000";
  return "gt1000";
}

/**
 * Konten für den Betreiber. Bewusst nur Benutzername, Anzeigename, Rolle, Status, eine grobe Größenklasse der
 * Monatssumme und eine Warnung bei Ungewöhnlichem (fester Schwellenwert oder Vielfaches des 3-Monats-Durchschnitts).
 * Keine Beträge, keine Zahlungsdaten, keine E-Mail, keine Teilnehmer.
 */
export function getOperatorAccounts(db: Db, cfg: { thresholdCents: number; factor: number }, now: Date = new Date()): OperatorAccount[] {
  const cur = currentMonth(now);
  const all = db.select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, passwordHash: users.passwordHash, disabledAt: users.disabledAt }).from(users).orderBy(users.username).all();
  const owners = new Set(db.select({ o: subscriptions.ownerUserId }).from(subscriptions).all().map((r) => r.o));
  return all.map((u) => {
    let volume = 0;
    let warning: OperatorAccount["warning"] = null;
    if (owners.has(u.id)) {
      const dueOf = (m: Month) => computeOwnerMonth(db, u.id, m).totals.filter((t) => t.payable).reduce((s, t) => s + t.totalCents, 0);
      volume = dueOf(cur);
      const prev = [1, 2, 3].map((i) => dueOf(addMonths(cur, -i))).filter((v) => v > 0);
      const avg = prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : 0;
      if (volume >= cfg.thresholdCents) warning = "threshold";
      else if (avg > 0 && volume > cfg.factor * avg) warning = "jump";
    }
    return {
      id: u.id, username: u.username, displayName: u.displayName, role: u.role,
      status: u.disabledAt ? "disabled" : u.passwordHash ? "active" : "invited",
      volumeClass: volumeClassOf(volume), warning,
    };
  });
}

// =====================================================================================
// Verwaltungsdaten des Empfängers (eigene Abos mit Preisen und Beteiligten)
// =====================================================================================

export interface ManageData {
  /** Darf Abos anlegen (IBAN oder PayPal.Me hinterlegt). */
  canOwn: boolean;
  /** Frühester Monat für Änderungen an Bestehendem (immer der Folgemonat). */
  nextMonth: Month;
  /** Frühester Monat für ein neues Abo oder einen neuen Mitzahler (laufender Monat, solange noch keine Zahlungen angelegt sind). */
  newStartMonth: Month;
  subscriptions: Array<{ id: number; name: string; archivedAt: string | null }>;
  prices: Array<{ subscriptionId: number; validFromMonth: Month; amountCents: number }>;
  memberships: Array<{ subscriptionId: number; userId: number; displayName: string; weight: number; validFromMonth: Month; validToMonth: Month | null }>;
}

export function getManageData(db: Db, user: { id: number; iban: string | null; paypalMe: string | null }, now: Date = new Date()): ManageData {
  const subs = db.select({ id: subscriptions.id, name: subscriptions.name, archivedAt: subscriptions.archivedAt }).from(subscriptions).where(eq(subscriptions.ownerUserId, user.id)).orderBy(subscriptions.name).all();
  const ids = subs.map((s) => s.id);
  const prices = ids.length ? db.select().from(subscriptionPrices).where(inArray(subscriptionPrices.subscriptionId, ids)).all() : [];
  const ms = ids.length
    ? db
        .select({ m: memberships, displayName: users.displayName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(inArray(memberships.subscriptionId, ids))
        .all()
    : [];
  return {
    canOwn: !!(user.iban || user.paypalMe),
    nextMonth: nextChangeMonth(now),
    newStartMonth: firstStartMonthForNew(db, user.id, now),
    subscriptions: subs,
    prices: prices.map((p) => ({ subscriptionId: p.subscriptionId, validFromMonth: p.validFromMonth, amountCents: p.amountCents })),
    memberships: ms.map((r) => ({ subscriptionId: r.m.subscriptionId, userId: r.m.userId, displayName: r.displayName, weight: r.m.weight, validFromMonth: r.m.validFromMonth, validToMonth: r.m.validToMonth })),
  };
}
