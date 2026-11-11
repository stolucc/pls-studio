import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InviteSent } from './ShareDialog';

const link = 'https://pls.example.org/?invite=abc';

describe('after inviting someone', () => {
  it('says plainly when no email went out, and offers the link to send', () => {
    const html = renderToStaticMarkup(
      <InviteSent sent={{ email: 'ann@example.org', link, emailed: false }} onCopy={() => {}} />,
    );
    expect(html).toContain('No email was sent');
    expect(html).toContain(`value="${link}"`);
    expect(html).toContain('Copy link');
    expect(html).toContain('Only an account with ann@example.org can accept it');
  });

  it('confirms the email, still showing the link', () => {
    const html = renderToStaticMarkup(
      <InviteSent sent={{ email: 'ann@example.org', link, emailed: true }} onCopy={() => {}} />,
    );
    expect(html).toContain('Invitation emailed to <b>ann@example.org</b>');
    expect(html).not.toContain('No email was sent');
    expect(html).toContain(`value="${link}"`);
  });
});
