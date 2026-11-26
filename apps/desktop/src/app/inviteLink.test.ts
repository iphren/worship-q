import { routerView } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { ROUTER_LINKS, inviteLink, type InviteLinkFields } from './inviteLink';

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
    for (const server of [
      'http://church.org',
      'https://10.0.0.9:8443',
      'https://church.org/wq',
      'https://worship:8443',
    ]) {
      expect(inviteLink({ server, workspace: 'w', invite: 'd.s', lan: null }, true)).toBe(
        `${server}/remote/?w=w#i=d.s`,
      );
    }
  });

  it('reaches the same phone page through the router as directly', () => {
    const cases: InviteLinkFields[] = [
      { server: 'https://church.org', workspace: 'ws-1', invite: 'd.s', lan: null },
      { server: 'https://Church.org:443', workspace: 'ws 1', invite: 'd.s', lan: LAN },
      {
        server: 'https://church.org:8443',
        workspace: 'w&x=1',
        invite: 'dev-1.abc_DEF',
        lan: { fingerprint: 'AB:CD:EF', addresses: ['10.0.0.2', 'fd00::1'], port: 47311 },
      },
    ];
    for (const fields of cases) {
      const direct = inviteLink(fields, false);
      const view = routerView(new URL(inviteLink(fields, true)).hash);
      if (view.kind !== 'continue') throw new Error(`router page shows ${view.kind}`);
      expect(phonePageReads(view.href), fields.server).toEqual(phonePageReads(direct));
    }
  });
});

/** What the phone page takes from its address (`apps/remote`'s `RemoteConnection`). */
function phonePageReads(link: string) {
  const url = new URL(link);
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    origin: url.origin,
    path: url.pathname,
    workspace: url.searchParams.get('w'),
    invite: hash.get('i'),
    fingerprint: hash.get('f'),
    addresses: hash.get('a'),
    port: hash.get('p'),
  };
}
