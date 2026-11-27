import { describe, expect, it } from 'vitest';
import {
  invitationLink,
  phonePageLink,
  readInvitation,
  readScanned,
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
    expect(routerServer('https://example.org/?x=1')).toBeNull();
    expect(routerServer('https://example.org/#x')).toBeNull();
    expect(routerServer('not a url')).toBeNull();
  });

  it('leaves names without a dot, which only a church network knows', () => {
    expect(routerServer('https://localhost')).toBeNull();
    expect(routerServer('https://worship:8443')).toBeNull();
  });

  it('carries an international domain name in its ASCII form', () => {
    expect(routerServer('https://bücher.example')).toBe('xn--bcher-kva.example');
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

  it('round-trips a local workspace online, which also names its church server (N29)', () => {
    const invitation: Invitation = {
      server: 'public.worship-q.com',
      workspace: 'ws-1',
      local: 'loc-1',
      invite: 'x',
      lan: LAN,
    };
    const link = invitationLink(invitation);
    expect(link).toContain('#s=public.worship-q.com&w=ws-1&l=loc-1&i=x&');
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
    expect(readInvitation('#s=a.org&l=loc-1&i=1')).toBeNull();
    expect(readInvitation('#s=a.org&w=%20&i=1')).toBeNull();
  });

  it('refuses servers that would send the phone somewhere else', () => {
    for (const server of [
      'a.org%2Fevil',
      'a.org%3Fx',
      'a.org%23x',
      'a.org@evil.org',
      'a.org%40evil.org',
      'javascript:alert(1)',
      'http://evil.org',
      '//evil.org',
      'a.org.',
      '-a.org',
      'a-.org',
      '_a.org',
      'a..org',
      'localhost',
      'localhost:8080',
      '[fd00::1]',
      'a.org:0',
      'a.org:',
      `${'a'.repeat(64)}.org`,
      `${'a.'.repeat(127)}org`,
    ]) {
      expect(readInvitation(`#s=${server}&w=1&i=1`), server).toBeNull();
    }
  });

  it('tidies the server it carries', () => {
    expect(readInvitation('#s=%20Church.Example.ORG%20&w=1&i=1')?.server).toBe(
      'church.example.org',
    );
    expect(readInvitation('#s=church.example.org:443&w=1&i=1')?.server).toBe('church.example.org');
  });

  it('takes the first server when one is given twice, as the page shows it', () => {
    expect(routerView('#s=good.org&s=evil.org&w=1&i=1')).toMatchObject({ server: 'good.org' });
  });

  it('drops venue network hints that are incomplete or out of range', () => {
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&p=47311')?.lan).toBeUndefined();
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=10.0.0.2&p=0')?.lan).toBeUndefined();
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=10.0.0.2&p=70000')?.lan).toBeUndefined();
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=10.0.0.2&p=473.5')?.lan).toBeUndefined();
    expect(readInvitation('#s=a.org&w=1&i=1&a=10.0.0.2&p=47311')?.lan).toBeUndefined();
  });

  it('keeps the invitation when its hints are dropped', () => {
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=10.0.0.2&p=70000')).toEqual({
      server: 'a.org',
      workspace: '1',
      invite: '1',
    });
  });

  it('skips empty entries in the address list', () => {
    expect(readInvitation('#s=a.org&w=1&i=1&f=ab&a=,10.0.0.2,,10.0.0.3,&p=1')?.lan).toEqual({
      fingerprint: 'ab',
      addresses: ['10.0.0.2', '10.0.0.3'],
      port: 1,
    });
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
    expect(phonePageLink({ server: 'a.org', local: 'l', invite: 'i' })).toBeNull();
  });

  it('cannot be steered by what the hints contain', () => {
    const link = phonePageLink({
      server: 'a.org',
      workspace: 'w',
      invite: 'i&w=other',
      lan: { fingerprint: 'a&s=evil.org', addresses: ['x#y'], port: 1 },
    })!;
    const url = new URL(link);
    expect(url.origin).toBe('https://a.org');
    expect(url.pathname).toBe('/remote/');
    expect(url.searchParams.get('w')).toBe('w');
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(hash.get('i')).toBe('i&w=other');
    expect(hash.get('f')).toBe('a&s=evil.org');
    expect(hash.get('a')).toBe('x#y');
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

describe('readScanned (native apps M2.11)', () => {
  it('reads a router invitation, with the server’s address', () => {
    expect(
      readScanned('https://app.worship-q.com/j#s=church.example.org:8443&w=ws-1&i=d.s'),
    ).toEqual({
      server: 'church.example.org:8443',
      serverUrl: 'https://church.example.org:8443',
      workspace: 'ws-1',
      invite: 'd.s',
    });
  });

  it('reads a local workspace’s invitation with no server', () => {
    expect(readScanned('https://app.worship-q.com/j#l=loc-1&i=x')).toEqual({
      local: 'loc-1',
      invite: 'x',
    });
  });

  it('reads a direct link to a church server’s phone page (N31)', () => {
    expect(
      readScanned('http://192.168.1.10:8080/wq/remote/?w=ws%201#i=d.s&f=AB:CD&a=10.0.0.2&p=47311'),
    ).toEqual({
      serverUrl: 'http://192.168.1.10:8080/wq',
      workspace: 'ws 1',
      invite: 'd.s',
      lan: { fingerprint: 'AB:CD', addresses: ['10.0.0.2'], port: 47311 },
    });
  });

  it('gives a router link and a direct link to the same workspace the same address', () => {
    const routed = readScanned('https://app.worship-q.com/j#s=church.example.org&w=ws-1&i=a');
    const direct = readScanned('https://church.example.org/remote/?w=ws-1#i=b');
    expect(routed?.serverUrl).toBe(direct?.serverUrl);
    expect(direct?.server).toBe('church.example.org');
  });

  it('turns down anything else', () => {
    for (const text of [
      '',
      'hello',
      'https://example.org/',
      'https://church.example.org/remote/?w=ws-1',
      'https://church.example.org/remote/#i=d.s',
      'https://church.example.org/admin/?w=ws-1#i=d.s',
      'https://user:pw@church.example.org/remote/?w=1#i=1',
      'ftp://church.example.org/remote/?w=1#i=1',
      'https://app.worship-q.com/j#s=evil.org/x&w=1&i=1',
      'https://app.worship-q.com/other#s=a.org&w=1&i=1',
    ]) {
      expect(readScanned(text), text).toBeNull();
    }
  });
});
