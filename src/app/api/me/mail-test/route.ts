import { ctx, kickMail, mailCtx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { requestTestMail } from "@/lib/services/email";
import { AppError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export const POST = userRoute(({ user }) => {
  const m = mailCtx();
  if (!m) throw new AppError("not_allowed", "Dieser Server verschickt keine E-Mails.");
  requestTestMail(ctx().db, m, user.id);
  kickMail();
  return { ok: true };
});
