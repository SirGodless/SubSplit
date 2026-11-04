#!/usr/bin/env node
// Erzeugt ADMIN_PASSWORD_HASH. Passwort wird nicht als Argument übergeben (Shell-History):
//   node scripts/hash-password.mjs            (interaktive, verdeckte Eingabe)
//   echo 'passwort' | node scripts/hash-password.mjs
// Format muss mit src/lib/security/password.ts übereinstimmen (wird in tests/security.test.ts geprüft).
import { randomBytes, scryptSync } from "node:crypto";

const N = 65536, r = 8, p = 1;

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  process.stderr.write("Passwort: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.on("data", (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") buf = buf.slice(0, -1);
        else buf += c;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Passwort zu kurz (mindestens 12 Zeichen).");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
console.log(["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join(":"));
