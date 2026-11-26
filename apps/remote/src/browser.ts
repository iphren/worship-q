import type { PhoneLink, PhoneSocket } from '@worship-q/phone';

/**
 * The phone page's link: the church instance's relay at the page's own origin, and browser
 * storage for the name and grant. A phone browser usually refuses the coordinator's
 * self-signed certificate, so the venue network is left to the app (native apps plan).
 */
export function browserLink(location: Location): PhoneLink {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const workspace = query.get('w') ?? '';
  const fingerprint = hash.get('f');
  const addresses = (hash.get('a') ?? '').split(',').filter(Boolean);
  const port = Number(hash.get('p') ?? 0);
  const grantKey = `wq.remote.grant.${workspace}`;
  return {
    workspace,
    invite: hash.get('i'),
    lan: fingerprint && addresses.length > 0 && port > 0 ? { addresses, port, fingerprint } : null,
    connect: () => relaySocket(`${location.origin.replace(/^http/, 'ws')}/api/v1/remote`),
    store: {
      name: () => storage('wq.remote.name') ?? '',
      setName: (name) => void storage('wq.remote.name', name),
      grant: () => storage(grantKey),
      setGrant: (grant) => void storage(grantKey, grant),
    },
    fileUrl: (name) =>
      `/api/v1/remote/files/${encodeURIComponent(workspace)}/${encodeURIComponent(name)}`,
    // Reloading the page uses the grant, not the used invitation.
    inviteUsed: () => history.replaceState(null, '', location.pathname + location.search),
  };
}

/** A browser WebSocket to the relay, as a `PhoneSocket`. */
export function relaySocket(url: string): PhoneSocket {
  const socket = new WebSocket(url);
  const phone: PhoneSocket = {
    get open() {
      return socket.readyState === WebSocket.OPEN;
    },
    via: 'relay',
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  socket.onopen = () => phone.onopen?.();
  socket.onmessage = (event) => phone.onmessage?.(String(event.data));
  socket.onclose = (event) =>
    phone.onclose?.({ code: event.code, reason: event.reason, wasClean: event.wasClean });
  return phone;
}

function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing: the phone is asked again next time.
  }
  return value ?? null;
}
