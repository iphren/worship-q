# Worship Q — Running the Public Server

The public server is the church server (`apps/server`) in public mode, run by the project at
`https://public.worship-q.com` for every workspace without a church server (see the
[plan](public-server-plan.md) and the [discovery](public-server-discovery.md)). This guide is
for whoever runs it; churches running their own server follow the
[Church server deployment](server-deployment.md).

## What it does and keeps

- **Serves** the phone relay and page, Bible passages in versions that need no key, slide
  deck and image conversion, and live audio's STUN and TURN, to workspaces that joined it.
- **Refuses** everything else with 404: synchronization, backups, the live-state backup,
  browser outputs, videos, deck originals, reports, recordings, the presentation log, the
  admin app and the local API. A desktop typing its address into Church connection is told
  it is the public server; the pairing routes answer `403 public-server`, and enrolling
  answers `403 invalid-code`.
- **Keeps nothing.** A deck's images are deleted when the desktop has fetched them, and any
  file or conversion folder over a day old is deleted by the hourly sweep. A workspace whose
  computer has not connected for 90 days is forgotten, with its row and folder; the desktop
  joins again by itself the next time it opens.
- **Limits**, counted in memory and forgotten when their window ends: 2 phones and 2
  listeners at once per workspace; 100 slide decks and images a day per copy of the app; 5
  joins an hour per address; 600 Bible requests an hour per copy of the app; and five times
  each per-copy limit per address. A 6th deck waiting for conversion answers `503 busy`.

## Run it

It needs a data folder of its own. It refuses to start on a church server's, and a church
server refuses to start on its (the first start marks the folder public).

```sh
cat > apps/server/.env <<'END'
WORSHIP_Q_PORT=8090
WORSHIP_Q_PUBLIC_PROXY_HOPS=2
WORSHIP_Q_TURN_URL=turn:turn.worship-q.com:3478
WORSHIP_Q_TURN_SECRET=<a long random secret>
WORSHIP_Q_TURN_LISTEN_IP=<this host's own address>
WORSHIP_Q_TURN_EXTERNAL_IP=<the public address, or public/private behind NAT>
END
docker compose -f apps/server/compose.public.yaml up -d --build
```

`public.worship-q.com` points at CloudFront, which carries only HTTP, so the relay needs a name
of its own pointing straight at the host (here `turn.worship-q.com`). The proxy hops are 2 for
CloudFront and nginx (see **In front of it**).

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORSHIP_Q_PUBLIC` | `1` in the Compose file | Public mode; off when unset |
| `WORSHIP_Q_PUBLIC_PHONES` | `2` | Phones connected at once, per workspace |
| `WORSHIP_Q_PUBLIC_LISTENERS` | `2` | Live audio listeners at once, per workspace |
| `WORSHIP_Q_PUBLIC_MEDIA_PER_DAY` | `100` | Slide decks and images per day, per copy of the app |
| `WORSHIP_Q_PUBLIC_JOINS_PER_HOUR` | `5` | New workspaces per hour, per address |
| `WORSHIP_Q_PUBLIC_BIBLE_PER_HOUR` | `600` | Bible requests per hour, per copy of the app |
| `WORSHIP_Q_PUBLIC_IP_FACTOR` | `5` | An address may do this many times what one copy may |
| `WORSHIP_Q_PUBLIC_IDLE_DAYS` | `90` | Days unseen before a workspace is forgotten |
| `WORSHIP_Q_PUBLIC_PROXY_HOPS` | `1` | Proxies in front that add to `X-Forwarded-For`: the reverse proxy; `2` with a CDN before it |
| `WORSHIP_Q_MAX_IMAGE_MB`, `WORSHIP_Q_MAX_DECK_MB` | 25, 100 | Upload limits; videos are never taken |
| `WORSHIP_Q_TURN_MIN_PORT`, `WORSHIP_Q_TURN_MAX_PORT` | 49152, 65535 | The relay's UDP ports |
| `WORSHIP_Q_TURN_TOTAL` | `2000` | Relayed connections at once, in all |
| `WORSHIP_Q_TURN_MAX_BPS` | `200000` | Bytes a second per relayed connection |

A limit that is not a whole number of at least 1 stops the server at start, naming it. Bible
keys set in the environment are ignored, with a warning: a church's key may not be shared with
every user. Every keyless version a provider serves is offered unless `bibleVersions` is set
with `node dist/cli.js settings set bibleVersions '[...]'`.

## In front of it

CloudFront, then nginx, then the server: DNS for `public.worship-q.com` points at CloudFront,
and CloudFront's origin is nginx on the host. coturn answers on the host's own address,
outside both.

**Set `WORSHIP_Q_PUBLIC_PROXY_HOPS=2`** in `.env`. The default, 1, is for nginx alone. With it
behind CloudFront, every visitor counts as a CloudFront address and the limits trip almost at
once. Never set it higher than the proxies really there, because visitors could then choose
their own address and get past the limits.

**nginx** as for a church server (see **Reverse proxy and CloudFront** in the church guide),
with these differences:

- A body limit of at least 100 MB: `client_max_body_size 100m;`.
- WebSockets on `/api/v1/coordinator` and `/api/v1/remote` only.
- `X-Forwarded-For` added to, never replaced:
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. The limits count by the
  address two entries from the end, the one CloudFront saw. Anything earlier is the visitor's
  own writing.
- **Only CloudFront let in.** A request sent straight to nginx would put the visitor's own
  `X-Forwarded-For` entry where the server expects CloudFront's, and so get past the limits.
  CloudFront sends a secret header to the origin, and nginx refuses requests without it:

  ```nginx
  # In the public server's `server` block; the value is a long random string, kept out of
  # the repository.
  if ($http_x_origin_verify != "<secret>") { return 403; }
  ```

  If the host is on AWS, also let only CloudFront reach port 443, with the managed prefix list
  `com.amazonaws.global.cloudfront.origin-facing` in its security group.

**CloudFront**, one behavior for everything:

- **Allowed HTTP methods:** GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE.
- **Cache policy:** `CachingDisabled`.
- **Origin request policy:** `AllViewerExceptHostHeader` (or `AllViewer` if nginx routes by
  host name). It passes `Authorization`, `x-worship-q-protocol` and `x-worship-q-install`.
- **Viewer protocol policy:** Redirect HTTP to HTTPS.
- **Origin custom header:** `X-Origin-Verify: <secret>`, the same value as nginx's.
- **Origin protocol:** HTTPS only, so the secret never travels in the clear; nginx keeps a
  certificate for its own origin name.
- **Origin response timeout:** 60 seconds. A deck's upload answers only once it is converted,
  and may wait behind others first; the default 30 can cut a slow one off.

CloudFront passes WebSockets through without extra settings; the server's pings every 25
seconds keep idle ones open.

**UDP 3478 and the relay ports** open in the host's firewall and the provider's, outside
CloudFront and nginx. Each relayed listener uses one port.

Check it from outside:

```sh
curl https://public.worship-q.com/api/v1/info   # "public":true, "limits":{...}
curl https://public.worship-q.com/              # explains itself
```

And that a visitor cannot choose their address: six joins, each claiming another, should end
in `429` (they leave five empty workspaces, forgotten after 90 days unseen):

```sh
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://public.worship-q.com/api/v1/public/join \
    -H 'content-type: application/json' -H "X-Forwarded-For: 192.0.2.$i" \
    -d '{"protocolVersion":9}'
done   # 200 200 200 200 200 429
```

Six `200`s mean `WORSHIP_Q_PUBLIC_PROXY_HOPS` is higher than the proxies in front; a `429` at
once means nginx replaces `X-Forwarded-For` or the number is too low.

And that nginx refuses requests that bypass CloudFront (replace the address with the host's):

```sh
curl -s -o /dev/null -w "%{http_code}\n" --resolve public.worship-q.com:443:<host address> \
  https://public.worship-q.com/api/v1/info   # 403
```

## Logs and privacy

The request log keeps the method, the path without its query string (so no Bible search or
reference) and the status, but no address. The address is logged only with a request refused
for a limit (`Refused for a limit`, with which limit: `join`, `bible` or `media`). It never logs
a token or the install header. coturn's log has the address of each listener it relays.
Docker keeps each log to five files of 10 MB (`logging` in the Compose file) and drops the
oldest lines beyond that, so how long a line lasts depends on traffic, not on a date. The
privacy notice on worship-q.com must say what passes through (files while converted, phone
connections, audio relayed through TURN, the OBS picture through the relay), the deletion
rule above, what the log keeps and for how long, and where the server runs.

## Watching it

- **Up:** `GET /api/v1/info` answers with `"public":true`.
- **Disk:** only files under a day old and the database; growth means the sweep is failing.
- **Conversions:** `503 busy` answers in the log mean the queue is full too often.
- **Limits:** `Refused for a limit` lines by address; one address with many means abuse or a
  large church that should run its own server.
- **Relay:** coturn's log; allocations near `WORSHIP_Q_TURN_TOTAL`.

## Updating

With `scripts/update-server.sh public`, before the desktops'
release when the protocol version rises. One process holds every workspace's relay room, so a
restart drops every phone for a few seconds; they reconnect by themselves. More than one
process needs routing by workspace (the desktop's token and the phone's `w=` both name it)
to sticky backends.
