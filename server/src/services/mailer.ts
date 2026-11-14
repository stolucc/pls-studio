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

/**
 * What the fallback (no SMTP_URL) does with a message:
 * - 'full' (development): logs it whole, so the links can be opened from the console;
 * - 'summary' (production): logs recipient and subject only. The text carries
 *   live password-reset and verification links: in the journal anyone who can
 *   read the logs could take over the account. Nothing is kept in memory
 *   either (no one reads it, and it would grow without bound);
 * - 'none' (tests): logs nothing; the test reads the outbox.
 */
export type MailLog = 'full' | 'summary' | 'none';

/** SMTP when SMTP_URL is set; otherwise an in-memory outbox and/or the log (see MailLog). */
export function createMailer(
  smtpUrl: string | undefined,
  from: string,
  log: MailLog = 'summary',
): Mailer {
  const outbox: Mail[] = [];
  if (!smtpUrl) {
    return {
      outbox,
      configured: false,
      async send(m) {
        if (log === 'summary') {
          console.log(`[mail to ${m.to}] ${m.subject}: not sent: SMTP_URL is not set`);
          return;
        }
        outbox.push(m);
        if (log === 'full') console.log(`[mail to ${m.to}] ${m.subject}\n${m.text}\n`);
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
