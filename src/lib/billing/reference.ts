import { randomInt } from "node:crypto";

/** 32 Zeichen ohne O/0, I/1 (und kein Kleinbuchstabe l, da nur Großbuchstaben). */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERENCE_LENGTH = 6;

export function generateReferenceId(rand: (maxExclusive: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < REFERENCE_LENGTH; i++) out += REFERENCE_ALPHABET[rand(REFERENCE_ALPHABET.length)];
  return out;
}

/** Erzeugt eine ID, die laut `exists` noch nicht vergeben ist (Wiederholung bei Kollision). */
export function generateUniqueReferenceId(
  exists: (id: string) => boolean,
  rand?: (maxExclusive: number) => number,
  maxAttempts = 50,
): string {
  for (let i = 0; i < maxAttempts; i++) {
    const id = generateReferenceId(rand);
    if (!exists(id)) return id;
  }
  throw new Error("Keine freie Referenz-ID gefunden");
}
