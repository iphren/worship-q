# Spike M0 — Connections on the venue network

**Status:** not yet run on hardware. The code for M5 was written against the choices below
and compiles and passes its unit tests, but nothing here has been tried between two real
machines, on a phone, or on a guest network. Each item lists what to confirm and where the
result goes.

## Choices made for M5

| Concern | Choice | Why |
| --- | --- | --- |
| TLS | `rustls` 0.23 with the `ring` provider, `tokio-rustls` 0.26 | No OpenSSL, no cmake or NASM on Windows; one implementation on both platforms |
| Certificate | `rcgen` 0.13, self-signed, made once per workspace folder, kept as DER beside the database | Decision D19: a fingerprint per coordinator, stable across restarts |
| Fingerprint | SHA-256 of the DER certificate, upper-case colon-separated | Easy to show and compare; the client pins it and checks nothing else |
| WebSockets | `tokio-tungstenite` 0.26 over the TLS stream, `handshake` feature only | Keeps tungstenite's own TLS features, and their crypto providers, out of the build |
| Discovery | `mdns-sd` 0.12, service `_worship-q._tcp.local.`, instance = device id, TXT `ws` (workspace server id), `dev`, `fp`, `name` | Decision D20: only the workspace's identifier is announced |
| Ports | 47311 for the LAN server, next to 47310 for the localhost pages | Fixed, so firewall rules stay valid |
| Authentication | Desktops send their device token over TLS; the coordinator checks its SHA-256 against the workspace's device list from `GET /api/v1/workspace/lan-credentials`, cached for offline use. Phones send their grant, checked by the interface as through the relay | Criterion 32 without the server in the path |

## M0.1 — TLS WebSocket server and pinned client

Confirm on two machines on the same Wi-Fi:

- [ ] `Settings → Church connection` on the coordinator shows **On this network** for the
      follower once both are connected, within a few seconds of the follower starting.
- [ ] Changing the follower's expected fingerprint (edit `lanPeers` in `sync_state`) makes
      `lan_connect` fail with a certificate error and the follower stays on the relay.
- [ ] macOS asks once to allow incoming connections for Worship Q; Windows shows the firewall
      prompt for private networks. Record screenshots here.

## M0.2 — Phone browsers against the self-signed certificate

The phone page reads the coordinator's address and fingerprint from the invitation
(`#f=…&a=…&p=…`) but, by design, only reports them: a browser cannot pin a fingerprint, and
it will refuse a self-signed certificate it has not been told to trust.

- [ ] Safari on iOS: open `https://<coordinator ip>:47311/` once; record whether it offers
      to continue, and whether a WebSocket from the relay-served page then connects.
- [ ] Chrome on Android: the same.
- [ ] Record the outcome. Expected: both refuse, so phones use the relay (D19 notes). If
      either accepts after a manual step, M5.6 can try the LAN address first on that browser.

## M0.3 — mDNS on macOS and Windows

- [ ] Both platforms see each other's `_worship-q._tcp` within five seconds (`lan_browse`
      returns the other within one browse window of four seconds).
- [ ] The macOS local-network permission prompt appears on first advertise/browse; record it.
- [ ] Windows: confirm the firewall prompt covers UDP 5353 as well as TCP 47311.

## M0.4 — Guest network with client isolation

- [ ] On a guest network, two laptops do not see each other: `lan_browse` returns nothing
      within the window and the follower stays **Through the church server**.
- [ ] With internet also cut, the operator device becomes coordinator on its own after
      twelve seconds (plan M5.8) and the other does the same; when the network returns,
      the one whose live state started earlier keeps it (D14, M4.7).

## Exit

When every box is ticked, or an exception is recorded, update the known limits in
`docs/server-deployment.md` and the acceptance record in `docs/acceptance/phase-2.md`.
