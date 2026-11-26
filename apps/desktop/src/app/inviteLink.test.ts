import { describe, expect, it } from 'vitest';
import { ROUTER_LINKS, inviteLink } from './inviteLink';

const LAN = { fingerprint: 'ab:cd', addresses: ['10.0.0.2', '10.0.0.3'], port: 47311 };

describe('inviteLink', () => {
  it('is switched off until the phone apps are released (N15)', () => {
    expect(ROUTER_LINKS).toBe(false);
    expect(
      inviteLink({ server: 'https://church.org', workspace: 'w', invite: 'd.s', lan: null }),
    ).toBe('https://church.org/remote/?w=w#i=d.s');
  });

  it('keeps the direct link unchanged, with venue network hints', () => {
    expect(
      inviteLink(
        { server: 'https://church.org', workspace: 'ws 1', invite: 'd.s', lan: LAN },
        false,
      ),
    ).toBe('https://church.org/remote/?w=ws%201#i=d.s&f=ab%3Acd&a=10.0.0.2%2C10.0.0.3&p=47311');
  });

  it('goes through the router when switched on', () => {
    expect(
      inviteLink(
        { server: 'https://church.org:8443', workspace: 'w', invite: 'd.s', lan: LAN },
        true,
      ),
    ).toBe(
      'https://app.worship-q.com/j#s=church.org:8443&w=w&i=d.s&f=ab:cd&a=10.0.0.2,10.0.0.3&p=47311',
    );
  });

  it('keeps a direct link for addresses the router does not carry (N31)', () => {
    for (const server of ['http://church.org', 'https://10.0.0.9:8443', 'https://church.org/wq']) {
      expect(inviteLink({ server, workspace: 'w', invite: 'd.s', lan: null }, true)).toBe(
        `${server}/remote/?w=w#i=d.s`,
      );
    }
  });
});
