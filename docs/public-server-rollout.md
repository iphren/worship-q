# Worship Q — Public Server Rollout

**Status:** planned 20 November 2026. The code is on the `public-server` branch, reviewed and
tested; nothing below has been done yet.

How the public server goes from the branch to every user: infrastructure, a private test with
a build from the branch, the privacy notice, then the merge and release (v2.11.0). Each stage
ends with checks; the next starts only when they pass. The settings themselves are in
[Running the Public Server](public-server-deployment.md); this plan is the order and the gates.

## Stage 1 — Infrastructure

The path: DNS → CloudFront → nginx → the server container; coturn on the host's own address,
outside both.

1. **DNS**
   - `public.worship-q.com` → CloudFront.
   - `turn.worship-q.com` → the host, directly (CloudFront carries no UDP).
   - An origin name → the host, which CloudFront uses to reach nginx.
2. **Origin secret:** a long random value for the `X-Origin-Verify` header, kept in a password
   manager, never in the repository.
3. **nginx** (the public server's `server` block)
   - A certificate for the origin name.
   - The existing headers, with `X-Forwarded-For $proxy_add_x_forwarded_for`.
   - `client_max_body_size 100m;`.
   - WebSockets on `/api/v1/coordinator` and `/api/v1/remote`.
   - `403` for any request without the origin secret.
   - `access_log off;`: the privacy notice promises no other access logs.
4. **CloudFront**, one behavior:
   - All HTTP methods; `CachingDisabled`; `AllViewerExceptHostHeader`; redirect HTTP to HTTPS.
   - HTTPS to the origin, with the custom header `X-Origin-Verify: <secret>`.
   - Origin response timeout 60 seconds (deck conversions answer when done).
   - A certificate for `public.worship-q.com` in us-east-1.
   - Standard logging and real-time logs off.
5. **Host journal:** journald deletes logs after 14 days (the settings in the guide's **Logs and
   privacy**), as the privacy notice says.
6. **Firewall** (the host's and the provider's): UDP 3478 and the relay ports (49152–65535 by
   default) open; 443 open, or only to CloudFront's `origin-facing` prefix list on AWS.

**Gate:** `https://public.worship-q.com/` reaches nginx through CloudFront (a 502 from the
missing container is fine at this point), and the origin name without the secret answers
`403`.

## Stage 2 — Deploy the server from the branch

1. Check out `public-server` on the host.
2. Write `apps/server/.env`:
   - `WORSHIP_Q_PORT=8090`
   - `WORSHIP_Q_PUBLIC_PROXY_HOPS=2`
   - `WORSHIP_Q_TURN_URL=turn:turn.worship-q.com:3478`
   - `WORSHIP_Q_TURN_SECRET`, `WORSHIP_Q_TURN_LISTEN_IP`, `WORSHIP_Q_TURN_EXTERNAL_IP`
   - Everything else at its default.
3. `docker compose -f apps/server/compose.public.yaml up -d --build`. It uses its own volume;
   it refuses to start on a church server's data.

**Gate**, all from outside:

| Check | Expect | If not |
| --- | --- | --- |
| `curl https://public.worship-q.com/api/v1/info` | `"public":true` | Container or nginx upstream |
| Six joins, each with another fake `X-Forwarded-For` (the loop in the guide) | `200` ×5, then `429` | Six `200`s: hops too high, or nginx reachable without CloudFront. `429` at once: hops too low, or nginx replaces the header |
| The server log after the sixth | One `Refused for a limit` line, `limit: "join"`, your own address | Wrong address: the hop count |
| `curl --resolve public.worship-q.com:443:<host address> …/api/v1/info` | `403` | nginx's origin secret rule |
| `/api/v1/info` | `"audioRelay":true` | `WORSHIP_Q_TURN_URL` or `WORSHIP_Q_TURN_SECRET` unset |
| [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) with `turn:turn.worship-q.com:3478` and a credential from `GET /api/v1/ice`, using a `deviceToken` from one of the joins | A `relay` candidate | Firewall, or the TURN addresses |

The six joins leave five empty workspaces; they are forgotten after 90 days unseen.

## Stage 3 — Private test with a build from the branch

No released app speaks protocol 9 yet, so the test uses a build from `public-server`
(`https://public.worship-q.com` is its default address). The walkthrough is M9.1 in the
[task breakdown](public-server-task-breakdown.md), recorded in
`docs/acceptance/public-server.md`, on macOS and on Windows:

- A new install makes no network requests at launch until a feature is used.
- A phone on mobile data scans the QR code, is approved, moves slides, sees deck thumbnails
  and listens to live audio through TURN; a third listener and a third phone are refused with
  the message.
- A 100-slide deck imports; the server's folder is empty a minute later.
- Bible passages load; images upload.
- The server is stopped mid-service: the presentation continues, the workspace button turns
  amber with the reason, phones come back when it returns.
- Quit and relaunch: it connects again by itself.
- Typing the public address in Church connection shows the message.
- Joining a church server after using the public server works, and the public connection
  stops.
- Videos: a local workspace with 150 MB of videos on past run sheets shows the banner after
  30 minutes; a church computer removes old copies silently.

**Gate:** the owner accepts the walkthrough. Fixes go to the branch with tests, and the
server is redeployed from it.

## Stage 4 — Privacy notice (M7.5)

Written on 20 November 2026 at `/privacy/` (`apps/website/pages/privacy.md`, and the Chinese
pages under `zh-hans/` and `zh-hant/`), linked from the footer and the FAQ. It goes live with
the merge in stage 6, before any user is pointed at the server. It states:

- IHS Technology as the controller; the server on AWS in London behind CloudFront.
- What passes through and how long it stays; what the server knows about a computer.
- Logs: no addresses except for requests refused for a limit and coturn's relayed listeners;
  deleted after 14 days.
- The others involved: AWS, the Free Use Bible API, Google's STUN, GitHub, Cloudflare.

**Gate:** the infrastructure matches it: journald's 14 days, no nginx or CloudFront access
logs. A change to the server's logging or retention changes the notice too.

## Stage 5 — Monitoring (M7.4)

- Up check on `/api/v1/info`, alerting the owner.
- Disk: only files under a day old and the database; growth means the sweep is failing.
- `503 busy` and `Refused for a limit` lines in the log.
- coturn allocations near `WORSHIP_Q_TURN_TOTAL`.

**Gate:** an alert reaches the owner when the container is stopped.

## Stage 6 — Merge and release

1. Merge `public-server` into `main`. The website deploys at once (`website.yml`) with the
   guide pages and the privacy notice; release-please opens its release PR for **v2.11.0**.
2. Merge the release PR. `release.yml` builds a **draft** GitHub Release with the installers.
3. Install from the draft on macOS and Windows; a new install joins the public server.
4. Publish the draft. Installed apps then update to 2.11.0, and new ones use the public server.
5. Move the server's checkout from `public-server` to `main` and redeploy, so it runs what was
   released.

**Gate:** none after this; watch the monitoring closely for the first week.

## If something goes wrong

- **Before publishing the release** (stages 1–6.3): no user knows the server. Fix on the
  branch, or take the container down; nothing else depends on it.
- **After publishing:** the server stays up and fixes go forward in a patch release. If it
  must go down, presentations carry on without it (checked in stage 3); phones, Bible
  passages, deck conversion and live audio relay stop until it returns. Leaving the release
  published and the server down is better than pulling the release, since apps already
  updated keep the version.
- **Abuse:** `Refused for a limit` lines from one address show it; lower the limits in `.env`
  and restart, or block the address in CloudFront (AWS WAF).
- **Running out of capacity:** a church that relies on it every week is told about running its
  own server; the limits in `.env` can be raised for everyone.

## Decisions

Made on 20 November 2026: the server runs on AWS in London (eu-west-2) behind CloudFront; IHS
Technology is the controller; logs are deleted after 14 days. Still open: linking the notice
from the app's one-computer notes (M7.5's last part), which needs a desktop release.
