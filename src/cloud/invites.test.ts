import { describe, expect, it } from 'vitest';
import { linkParams } from './invites';

describe('emailed links', () => {
  it('carry their token in the fragment (never sent to the server), with the query form of older emails still read', () => {
    expect(linkParams('https://pls.example/#verify=abc%2Bd')).toEqual({
      params: { verify: 'abc+d' },
      cleaned: '/',
    });
    expect(linkParams('https://pls.example/?reset=old&x=1')).toEqual({
      params: { reset: 'old' },
      cleaned: '/?x=1',
    });
    expect(linkParams('https://pls.example/?auth=ok#invite=t&other=keep')).toEqual({
      params: { auth: 'ok', invite: 't' },
      cleaned: '/#other=keep',
    });
    expect(linkParams('https://pls.example/')).toEqual({ params: {}, cleaned: '/' });
  });
});
