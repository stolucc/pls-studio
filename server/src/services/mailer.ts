import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}
/** `configured` is false when mail only goes to the log, so callers can say so. */
export interface Mailer {
  send(m: Mail): Promise<void>;
  outbox: Mail[];
  configured: boolean;
}

/** SMTP when SMTP_URL is set; otherwise an in-memory outbox (development and tests). */
export function createMailer(smtpUrl: string | undefined, from: string, log = true): Mailer {
  const outbox: Mail[] = [];
  if (!smtpUrl) {
    return {
      outbox,
      configured: false,
      async send(m) {
        outbox.push(m);
        if (log) console.log(`[mail to ${m.to}] ${m.subject}\n${m.text}\n`);
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    outbox,
    configured: true,
    async send(m) {
      await transport.sendMail({ from, ...m });
    },
  };
}
