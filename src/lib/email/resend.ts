import { Resend } from "resend";
import { createLogger } from "@/lib/logger";

const log = createLogger("email");

const resend = new Resend(process.env.AUTH_RESEND_KEY);
const from = process.env.EMAIL_FROM ?? "noreply@websitepls.com";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  if (!process.env.AUTH_RESEND_KEY) {
    log.warn("AUTH_RESEND_KEY not set — skipping email send", { to, subject });
    return;
  }

  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    log.error("Failed to send email", { to, subject, error: String(error) });
    throw new Error(`Failed to send email: ${error.message}`);
  }

  log.info("Email sent", { to, subject });
}
