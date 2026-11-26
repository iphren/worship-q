import { describe, expect, it } from 'vitest';
import {
  invitationLink,
  phonePageLink,
  readInvitation,
  routerServer,
  routerView,
  type Invitation,
} from './invitation';

const LAN = {
  fingerprint: 'be:c5:d8:70',
  addresses: ['10.0.0.52', '192.168.1.4'],
  port: 47311,
};

describe('routerServer', () => {
  it('carries an https host name, with its port when it is not 443', () => {
    expect(routerServer('https://church.example.org')).toBe('church.example.org');
    expect(routerServer('https://church.example.org/')).toBe('church.example.org');
    expect(routerServer('https://Church.Example.org:443')).toBe('church.example.org');
    expect(routerServer('https://church.example.org:8443')).toBe('church.example.org:8443');
  });

  it('leaves the addresses that keep a direct link (N31)', () => {
    expect(routerServer('http://church.example.org')).toBeNull();
    expect(routerServer('https://192.168.1.10')).toBeNull();
    expect(routerServer('https://[fd00::1]')).toBeNull();
    expect(routerServer('https://example.org/worship')).toBeNull();
    expect(routerServer('https://user:pw@example.org')).toBeNull();
    expect(routerServer('not a url')).toBeNull();
  });
});

describe('invitationLink and readInvitation', () => {
  it('round-trips a church workspace with venue network hints', () => {
    const invitation: Invitation = {
      server: 'church.example.org',
      workspace: 'ws-1',
      invite: 'dev.secret',
      lan: LAN,
    };
    const link = invitationLink(invitation);
    expect(link).toBe(
      'https://app.worship-q.com/j#s=church.example.org&w=ws-1&i=dev.secret' +
        '&f=be:c5:d8:70&a=10.0.0.52,192.168.1.4&p=47311',
    );
    expect(readInvitation(new URL(link).hash)).toEqual(invitation);
  });

  it('round-trips a local workspace with no internet: no server or workspace (N29)', () => {
    const invitation: Invitation = { local: 'loc-1', invite: 'x', lan: LAN };
    const link = invitationLink(invitation);
    expect(link).toBe(
      'https://app.worship-q.com/j#l=loc-1&i=x&f=be:c5:d8:70&a=10.0.0.52,192.168.1.4&p=47311',
    );
    expect(readInvitation(new URL(link).hash)).toEqual(invitation);
  });

  it('encodes values that would break the fragment', () => {
    const link = invitationLink({ server: 'a.org', workspace: 'w&x=1', invite: 'i#2' });
    expect(readInvitation(new URL(link).hash)).toMatchObject({ workspace: 'w&x=1', invite: 'i#2' });
  });

  it('turns down invitations it cannot use', () => {
    expect(readInvitation('')).toBeNull();
    expect(readInvitation('#s=a.org&w=1')).toBeNull();
    expect(readInvitation('#s=a.org&i=1')).toBeNull();
    expect(readInvitation('#i=1')).toBeNull();
    expect(readInvitation('#s=10.0.0.1&w=1&i=1')).toBeNull();
    expect(readInvitation('#s=evil.org/path&w=1&i=1')).toBeNull();
    expect(readInvitation('#s=a.org:99999&w=1&i=1')).toBeNull();
  });

  it('drops venue network hints that are incomplete', () => {
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&p=47311')?.lan).toBeUndefined();
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=10.0.0.2&p=0')?.lan).toBeUndefined();
  });
});

describe('phonePageLink', () => {
  it('is the link a direct QR code opens today', () => {
    expect(
      phonePageLink({
        server: 'church.example.org:8443',
        workspace: 'ws 1',
        invite: 'd.s',
        lan: LAN,
      }),
    ).toBe(
      'https://church.example.org:8443/remote/?w=ws%201#i=d.s' +
        '&f=be:c5:d8:70&a=10.0.0.52,192.168.1.4&p=47311',
    );
  });

  it('needs a server and a workspace', () => {
    expect(phonePageLink({ local: 'l', invite: 'i' })).toBeNull();
  });
});

describe('routerView', () => {
  it('offers the church phone page for a church workspace', () => {
    expect(routerView('#s=church.example.org&w=ws-1&i=d.s')).toEqual({
      kind: 'continue',
      server: 'church.example.org',
      href: 'https://church.example.org/remote/?w=ws-1#i=d.s',
    });
  });

  it('says the app is needed when there is no server', () => {
    expect(routerView('#l=loc-1&i=x&f=ab&a=10.0.0.2&p=47311')).toEqual({ kind: 'app-only' });
  });

  it('reports a link it cannot read', () => {
    expect(routerView('')).toEqual({ kind: 'invalid' });
    expect(routerView('#s=http://evil.org&w=1&i=1')).toEqual({ kind: 'invalid' });
  });
});
