export type AppErrorCode = "not_allowed" | "not_found" | "invalid";

/** Erwarteter Fehler mit verständlicher Meldung (wird von der API in 400/404/409 übersetzt). */
export class AppError extends Error {
  constructor(public readonly code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}
