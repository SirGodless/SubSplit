import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Monate werden überall als "YYYY-MM" gespeichert. */
const MONTH_RE = "'____-__'";
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(now),
});

/** Preishistorie: gültiger Preis eines Monats = Zeile mit größtem valid_from_month <= Monat. */
export const subscriptionPrices = sqliteTable(
  "subscription_prices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    validFromMonth: text("valid_from_month").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [
    uniqueIndex("subscription_prices_sub_month_uq").on(t.subscriptionId, t.validFromMonth),
    check("subscription_prices_amount_ck", sql`${t.amountCents} >= 0`),
    check("subscription_prices_month_ck", sql`${t.validFromMonth} LIKE ${sql.raw(MONTH_RE)}`),
  ],
);

export const participants = sqliteTable(
  "participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    displayName: text("display_name").notNull(),
    /** Intern, für Mitzahler nie sichtbar. Optional (Phase 2). */
    email: text("email"),
    /** Genau ein Teilnehmer ist der Admin/Empfänger selbst: Anteil wird berechnet, aber nicht als Zahlung geführt. */
    isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
    /** SHA-256 des Magic-Link-Tokens (Token selbst nie gespeichert). */
    tokenHash: text("token_hash").notNull().unique(),
    tokenRevokedAt: text("token_revoked_at"),
    remindersEnabled: integer("reminders_enabled", { mode: "boolean" }).notNull().default(true),
    unsubscribeTokenHash: text("unsubscribe_token_hash").unique(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("participants_single_owner_uq").on(t.isOwner).where(sql`${t.isOwner} = 1`)],
);

/** Beteiligung an einem Abo. Gewichtsänderung = neue Zeile mit neuem valid_from_month. */
export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    participantId: integer("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    validFromMonth: text("valid_from_month").notNull(),
    /** Letzter Monat der Beteiligung (inklusive); null = unbefristet. */
    validToMonth: text("valid_to_month"),
  },
  (t) => [
    index("memberships_sub_idx").on(t.subscriptionId),
    index("memberships_participant_idx").on(t.participantId),
    check("memberships_weight_ck", sql`${t.weight} >= 1`),
    check("memberships_range_ck", sql`${t.validToMonth} IS NULL OR ${t.validToMonth} >= ${t.validFromMonth}`),
  ],
);

/** Genau eine Monatszahlung pro (Teilnehmer, Monat). Nie für den Owner. */
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    participantId: integer("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    referenceId: text("reference_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: ["open", "marked_paid", "confirmed"] })
      .notNull()
      .default("open"),
    markedPaidAt: text("marked_paid_at"),
    confirmedAt: text("confirmed_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("payments_participant_month_uq").on(t.participantId, t.month),
    uniqueIndex("payments_reference_uq").on(t.referenceId),
    check("payments_amount_ck", sql`${t.amountCents} >= 0`),
  ],
);

/** Phase 2: verhindert Doppelversand, dient als Nachweis. Im MVP ungenutzt. */
export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    sentAt: text("sent_at").notNull().default(now),
    status: text("status", { enum: ["sent", "error"] }).notNull(),
    error: text("error"),
  },
  (t) => [index("reminder_log_payment_idx").on(t.paymentId)],
);
