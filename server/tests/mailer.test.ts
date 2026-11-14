import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer } from '../src/services/mailer.ts';

const mail = {
  to: 'ann@example.org',
  subject: 'Reset your PLS Studio password',
  text: 'Open this link: https://app.example/#reset=SECRET-TOKEN',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mailer without SMTP_URL', () => {
  it('in production logs recipient and subject only, never the link, and keeps nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = createMailer(undefined, 'from@example.org', 'summary');
    await m.send(mail);
    const logged = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('ann@example.org');
    expect(logged).toContain('Reset your PLS Studio password');
    expect(logged).toContain('not sent: SMTP_URL is not set');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(m.outbox).toEqual([]);
    expect(m.configured).toBe(false);
  });

  it('defaults to the production behaviour', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createMailer(undefined, 'from@example.org').send(mail);
    expect(log.mock.calls.join('\n')).not.toContain('SECRET-TOKEN');
  });

  it('in development logs the whole message; in tests keeps it in the outbox silently', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dev = createMailer(undefined, 'from@example.org', 'full');
    await dev.send(mail);
    expect(log.mock.calls.join('\n')).toContain('SECRET-TOKEN');
    log.mockClear();
    const test = createMailer(undefined, 'from@example.org', 'none');
    await test.send(mail);
    expect(log).not.toHaveBeenCalled();
    expect(test.outbox).toEqual([mail]);
  });
});
