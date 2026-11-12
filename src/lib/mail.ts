import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 25);
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim() || user;
  if (!from) return null;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 25,
    secure,
    user,
    pass,
    from,
  };
}

export async function sendHandoffMail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    throw new Error(
      "Mail is not configured on the server. Set SMTP_HOST and SMTP_FROM (and SMTP_PORT if it is not 25).",
    );
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transport.sendMail({
    from: cfg.from,
    to: opts.to.join(", "),
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
