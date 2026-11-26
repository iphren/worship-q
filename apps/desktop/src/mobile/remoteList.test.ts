import { readScanned, type RemoteView } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIST,
  fileUrl,
  findEntry,
  fromView,
  lastOpened,
  openInvitation,
  parseList,
  relayUrl,
  remove,
  replace,
  type RemoteList,
} from './remoteList';

let ids = 0;
const newId = () => `e${++ids}`;
const scan = (text: string) => {
  const scanned = readScanned(text);
  if (!scanned) throw new Error(`unreadable: ${text}`);
  return scanned;
};

const ROUTED = 'https://app.worship-q.com/j#s=church.example.org&w=ws-1&i=first';
const DIRECT = 'https://church.example.org/remote/?w=ws-1#i=second&f=AB:CD&a=10.0.0.2&p=47311';

describe('the workspace list (native apps M2.10, M2.11)', () => {
  it('adds a workspace from its first scan, with the invitation to ask with', () => {
    const { list, entry, added } = openInvitation(EMPTY_LIST, scan(ROUTED), newId);
    expect(added).toBe(true);
    expect(list.entries).toEqual([entry]);
    expect(entry).toMatchObject({
      serverUrl: 'https://church.example.org',
      workspace: 'ws-1',
      name: 'church.example.org',
      invite: 'first',
      ended: false,
    });
  });

  it('opens a workspace already on the list and sends no request (N13)', () => {
    const first = openInvitation(EMPTY_LIST, scan(ROUTED), newId);
    const used = replace(first.list, { ...first.entry, invite: null });
    // The same workspace by its direct link: the same server address and workspace.
    const again = openInvitation(used, scan(DIRECT), newId);
    expect(again.added).toBe(false);
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.entry.invite).toBeNull();
    expect(again.list.entries).toHaveLength(1);
  });

  it('asks again with the new invitation when its access ended (N13)', () => {
    const first = openInvitation(EMPTY_LIST, scan(ROUTED), newId);
    const ended = replace(first.list, { ...first.entry, invite: null, ended: true });
    const again = openInvitation(ended, scan(DIRECT), newId);
    expect(again.entry).toMatchObject({ id: first.entry.id, invite: 'second', ended: false });
  });

  it('never matches by name', () => {
    const first = openInvitation(EMPTY_LIST, scan(ROUTED), newId);
    const named = replace(first.list, { ...first.entry, name: 'Sunday' });
    const other = scan('https://app.worship-q.com/j#s=other.example.org&w=ws-1&i=x');
    expect(findEntry(named, other)).toBeNull();
  });

  it('matches a local workspace by its permanent identifier, and takes its new address (N22)', () => {
    const first = openInvitation(
      EMPTY_LIST,
      scan('https://app.worship-q.com/j#l=loc-1&i=x'),
      newId,
    );
    expect(first.entry).toMatchObject({ serverUrl: null, workspace: null, local: 'loc-1' });
    const online = openInvitation(
      first.list,
      scan('https://app.worship-q.com/j#s=public.worship-q.com&w=new&l=loc-1&i=y'),
      newId,
    );
    expect(online.added).toBe(false);
    expect(online.entry).toMatchObject({
      serverUrl: 'https://public.worship-q.com',
      workspace: 'new',
    });
  });

  it('trusts the invitation’s device until the coordinator gives its list (N30)', () => {
    const { entry } = openInvitation(EMPTY_LIST, scan(DIRECT), newId);
    expect(entry.devices).toEqual([
      { deviceId: '', name: '', fingerprint: 'AB:CD', addresses: ['10.0.0.2'], port: 47311 },
    ]);
    const desk = { deviceId: 'd1', name: 'Main', fingerprint: 'EF', addresses: ['x'], port: 1 };
    const view = { workspaceName: 'Sunday', status: 'live', devices: [desk] } as RemoteView;
    expect(fromView(entry, view)).toMatchObject({
      name: 'Sunday',
      presenting: true,
      devices: [desk],
    });
    // An older desktop sends no list: the one the phone has stands.
    const older = { workspaceName: 'Sunday', status: 'ended' } as RemoteView;
    expect(fromView(entry, older)).toMatchObject({ presenting: false, devices: entry.devices });
  });

  it('reopens the workspace used last, and forgets one removed', () => {
    let list: RemoteList = EMPTY_LIST;
    const a = openInvitation(list, scan(ROUTED), newId);
    list = replace(a.list, { ...a.entry, lastOpenedAt: '2026-11-26T09:00:00Z' });
    const b = openInvitation(
      list,
      scan('https://app.worship-q.com/j#s=b.example.org&w=2&i=z'),
      newId,
    );
    list = replace(b.list, { ...b.entry, lastOpenedAt: '2026-11-26T10:00:00Z' });
    expect(lastOpened(list)?.id).toBe(b.entry.id);
    list = remove(list, b.entry.id);
    expect(lastOpened(list)?.id).toBe(a.entry.id);
    expect(lastOpened(EMPTY_LIST)).toBeNull();
  });

  it('reaches the server’s relay and files at its address', () => {
    const { entry } = openInvitation(
      EMPTY_LIST,
      scan('http://192.168.1.10:8080/wq/remote/?w=ws%201#i=d.s'),
      newId,
    );
    expect(relayUrl(entry)).toBe('ws://192.168.1.10:8080/wq/api/v1/remote');
    expect(fileUrl(entry, 'a b.jpg')).toBe(
      'http://192.168.1.10:8080/wq/api/v1/remote/files/ws%201/a%20b.jpg',
    );
    const local = openInvitation(EMPTY_LIST, scan('https://app.worship-q.com/j#l=l&i=x'), newId);
    expect(relayUrl(local.entry)).toBeNull();
  });

  it('starts afresh from a list it cannot read', () => {
    expect(parseList(null)).toEqual(EMPTY_LIST);
    expect(parseList('nonsense')).toEqual(EMPTY_LIST);
    expect(parseList('{"version":2,"entries":[]}')).toEqual(EMPTY_LIST);
    const kept = JSON.stringify({ version: 1, phoneName: 'Sam', entries: [] });
    expect(parseList(kept)).toEqual({ version: 1, phoneName: 'Sam', entries: [] });
  });
});
