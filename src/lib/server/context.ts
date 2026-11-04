import { getDbHandle, type Db } from "@/db/client";
import { getConfig, type Config } from "@/lib/config";
import { createIpResolver, PEER_HEADER, type IpResolver } from "@/lib/security/client-ip";
import { RateLimiter } from "@/lib/security/rate-limit";
import { createSecurityLogger, type SecurityLogger } from "@/lib/security/security-log";

interface Ctx {
  config: Config;
  db: Db;
  logger: SecurityLogger;
  resolveIp: IpResolver;
  loginLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
}

const g = globalThis as unknown as { __subsplitCtx?: Ctx };

export function ctx(): Ctx {
  if (!g.__subsplitCtx) {
    const config = getConfig();
    g.__subsplitCtx = {
      config,
      db: getDbHandle().db,
      logger: createSecurityLogger({ file: config.securityLogFile }),
      resolveIp: createIpResolver(config.trustedProxyCidrs),
      loginLimiter: new RateLimiter(10, 15 * 60 * 1000), // fehlgeschlagene Admin-Logins je IP
      tokenLimiter: new RateLimiter(120, 60 * 1000), // Token-Abfragen je IP
    };
  }
  return g.__subsplitCtx;
}

export function clientIp(headers: Headers): string {
  return ctx().resolveIp(headers.get(PEER_HEADER), headers.get("x-forwarded-for"));
}
