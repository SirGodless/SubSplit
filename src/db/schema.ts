import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Monate werden überall als "YYYY-MM" gespeichert. Die gesamte Datei ist verschlüsselt (siehe client.ts). */
const MONTH_RE = "'____-__'";
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/**
 * Jeder ist ein Konto. Ein Konto kann Empfänger sein (Abos besitzen, Zahlungsdaten hinterlegen) und/oder
 * Mitzahler in Abos anderer. Die Empfängerdaten sind alle optional; zum Anlegen von Abos braucht es mindestens
 * IBAN oder PayPal.Me.
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Kleingeschrieben, eindeutig, für das Login. */
  username: text("username").notNull().unique(),
  /** Für Mitzahler im selben Abo sichtbar. */
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: text("role", { enum: ["operator", "user"] }).notNull().default("user"),
  /** null = Konto noch nicht eingerichtet (Einrichtungslink offen). */
  passwordHash: text("password_hash"),
  /** Wird bei Passwortwechsel/Sperre erhöht und macht bestehende Sitzungen ungültig. */
  sessionVersion: integer("session_version").notNull().default(0),
  /** SHA-256 des Einrichtungslinks (Erst-Einrichtung bzw. Passwort-Reset), nur als Hash gespeichert. */
  setupTokenHash: text("setup_token_hash").unique(),
  setupExpiresAt: text("setup_expires_at"),
  disabledAt: text("disabled_at"),
  // --- Empfängerdaten (alle optional) ---
  recipientName: text("recipient_name"),
  paypalMe: text("paypal_me"),
  iban: text("iban"),
  /** Fälligkeitstag im Monat (1-28), gilt für die Abos dieses Empfängers. */
  dueDay: integer("due_day").notNull().default(1),
  /** Phase 2. */
  remindersEnabled: integer("reminders_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(now),
  lastLoginAt: text("last_login_at"),
}, (t) => [check("users_due_day_ck", sql`${t.dueDay} BETWEEN 1 AND 28`)]);

/**
 * Einladungslinks zum Erstellen eines eigenen Kontos. Jedes Konto kann sie erzeugen (höchstens 5 offene gleichzeitig,
 * je 7 Tage gültig). Der Token wird nur als Hash gespeichert; den Link sieht der Ersteller nur beim Erzeugen.
 */
export const invitations = sqliteTable("invitations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  creatorUserId: integer("creator_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  consumedByUserId: integer("consumed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("invitations_creator_idx").on(t.creatorUserId)]);

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Der Empfänger: bezahlt das Abo und bekommt das Geld. */
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => [index("subscriptions_owner_idx").on(t.ownerUserId)]);

/** Preishistorie: gültiger Preis eines Monats = Zeile mit größtem valid_from_month <= Monat. */
export const subscriptionPrices = sqliteTable(
  "subscription_prices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    validFromMonth: text("valid_from_month").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [
    uniqueIndex("subscription_prices_sub_month_uq").on(t.subscriptionId, t.validFromMonth),
    check("subscription_prices_amount_ck", sql`${t.amountCents} >= 0`),
    check("subscription_prices_month_ck", sql`${t.validFromMonth} LIKE ${sql.raw(MONTH_RE)}`),
  ],
);

/** Beteiligung eines Kontos an einem Abo. Gewichtsänderung = neue Zeile mit neuem valid_from_month. */
export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    validFromMonth: text("valid_from_month").notNull(),
    /** Letzter Monat der Beteiligung (inklusive); null = unbefristet. */
    validToMonth: text("valid_to_month"),
  },
  (t) => [
    index("memberships_sub_idx").on(t.subscriptionId),
    index("memberships_user_idx").on(t.userId),
    check("memberships_weight_ck", sql`${t.weight} >= 1`),
    check("memberships_range_ck", sql`${t.validToMonth} IS NULL OR ${t.validToMonth} >= ${t.validFromMonth}`),
  ],
);

/** Genau eine Monatszahlung pro (Zahler, Empfänger, Monat). Nie vom Empfänger an sich selbst. */
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payerUserId: integer("payer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipientUserId: integer("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    referenceId: text("reference_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: ["open", "marked_paid", "confirmed"] }).notNull().default("open"),
    markedPaidAt: text("marked_paid_at"),
    confirmedAt: text("confirmed_at"),
    /** null = vom Dauerauftrag nicht berührt; "auto" = per Dauerauftrag bestätigt; "skipped" = vom Empfänger zurückgesetzt, nicht erneut automatisch. */
    standingOrderState: text("standing_order_state", { enum: ["auto", "skipped"] }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("payments_payer_recipient_month_uq").on(t.payerUserId, t.recipientUserId, t.month),
    uniqueIndex("payments_reference_uq").on(t.referenceId),
    index("payments_recipient_month_idx").on(t.recipientUserId, t.month),
    check("payments_amount_ck", sql`${t.amountCents} >= 0`),
    check("payments_not_self_ck", sql`${t.payerUserId} <> ${t.recipientUserId}`),
  ],
);

/**
 * Dauerauftrag: Zahler und Empfänger (jeder von beiden kann ihn setzen, Vertrauensbasis) geben an, dass die Zahlung per
 * Dauerauftrag läuft. Ab `from_month` werden Zahlungen am Fälligkeitstag automatisch bestätigt. Zeile weg = aus.
 */
export const standingOrders = sqliteTable(
  "standing_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payerUserId: integer("payer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipientUserId: integer("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fromMonth: text("from_month").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("standing_orders_pair_uq").on(t.payerUserId, t.recipientUserId),
    check("standing_orders_month_ck", sql`${t.fromMonth} LIKE ${sql.raw(MONTH_RE)}`),
    check("standing_orders_not_self_ck", sql`${t.payerUserId} <> ${t.recipientUserId}`),
  ],
);

/** Phase 2: verhindert Doppelversand, dient als Nachweis. Im MVP ungenutzt. */
export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    sentAt: text("sent_at").notNull().default(now),
    status: text("status", { enum: ["sent", "error"] }).notNull(),
    error: text("error"),
  },
  (t) => [index("reminder_log_payment_idx").on(t.paymentId)],
);
