# Phase 3 — Acceptance record

**Date:** 2 November 2026 (branch `phase-3`)
**Source:** [Phase 3 plan](../phase-3-plan.md) §5.

Three kinds of evidence are kept apart here: automated tests that run in CI (`pnpm test`),
the sign-in spike against real providers (M0) that has not been run, and the walkthrough with
real equipment (M6) that has not been done. Nothing in the last two is claimed.

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 sign-in spike | **Not run** | `docs/spikes/oidc.md` lists what to confirm with Entra ID and Google |
| M1 admin app and sign-in | Done (logic); pages by walkthrough | `oidc.test.ts` (PKCE, claims, the flow against an in-process issuer, discovery issuer check); `admin.test.ts` “sign-in (D27, D28)”: allowlist, subject binding, replayed state, return-to restricted to `/admin`, header required, sign-out, eight-hour idle session, not-configured instance; “administrators (D28)”: add idempotently, last one kept, seeded once from the environment; “workspaces”: create, rename, rotate code, codes switch; “devices”: list with how they joined, rename, revoke closes the socket; “church defaults”; `apps/admin/src/format.test.ts` for the pages’ helpers; CLI `admin add/list/remove` |
| M1 live state in the admin app (D38) | Done | `admin.test.ts` “shows a workspace’s live state from the server’s copy…”: not presenting, coordinator name and connection, expiry, the Live mark in the list, expired snapshot gone |
| M2 pairing (D29) | Done (logic); desktop flow by walkthrough | `admin.test.ts` “pairing from the device’s side (D29)”: code format and link, pending, approve with a name, token handed over once, enrolled as pairing with the approver, refuse, expiry after fifteen minutes, protocol 1 refused |
| M2 code retirement (D30) | Done | `admin.test.ts` “keeps connection codes working until the first administrator exists”; `versions.test.ts` setup enrols with codes before an administrator exists; `joinMethod.test.ts` (desktop): pairing only when the instance has sign-in and an administrator |
| M2 protocol 3 (D26) | Done | `index.test.ts` (protocol) “speaking an older server’s version”; `versions.test.ts` “gives a version 2 device exactly what it received before”; `sync.test.ts` “keeps a version 2 computer presenting the workspace’s version, with nothing new”; the desktop negotiates on connect and again after an update-needed answer (`CloudController.negotiate`, `RelayTransport.reconnect`) |
| M3 origins and shadows (D31) | Done | `versions.test.ts` “pulling with origins”: own version plus shadow for version 3, church without shadow for a workspace with no version, backgrounds never shadowed, `useChurchVersion` never enters the Church Library; `store.test.ts` “two versions of a song”: version made on edit, church copy kept, in-place edit in a managing workspace, origin-less without a church, hide as the workspace’s record, cursor reset by the migration |
| M3 the toggle (D32) | Done (logic); interface by walkthrough | `sync.test.ts` “two versions of a song (D31, D32)”: two computers converge on both versions, a computer joining later gets both and the choice, the choice synchronizes and search follows it, editing while the church’s is in use edits the workspace’s and switches, Delete our version goes back everywhere, a church deletion makes the song the workspace’s own, also when learnt in the same pull as the version, and a restore links the two versions again; `Session.setUseChurchVersion` relocates the presented piece like an edit; `OriginBadge`, `VersionsBar` and the church-edit hint in `apps/desktop` |
| M4 recoverable deletion (D34, D37) | Done (logic); pages by walkthrough | `admin.test.ts` “the Church Library (D34, D37)”: list, usage by workspace and date, delete reaches workspaces, restore, background usage through songs and output settings; `retention.test.ts` “the retention sweep”: nothing before 90 days, files and marker after, restore refused once files are gone, deck images and original together, files a workspace’s version or another item still uses kept, a workspace’s own deletion swept but a hidden church item never, lyrics songs untouched, `WORSHIP_Q_RETENTION_DAYS` |
| M5 Manage Church Library in the admin app (D36) | Done (logic); page by walkthrough | `admin.test.ts` “shows the conversion plan and turns Manage Church Library on, moving files”; `versions.test.ts` “flags overrides the church changed since, and drops versions set aside for the church’s” |
| M5 storage (U11) | Done | `admin.test.ts` “storage (U11)”; `retention.test.ts` “the storage report”: classification, prunable deck originals, database, volume |
| M6 walkthrough | **Not done** | Table below |
| M6 guides | Done | `server-deployment.md`, `volunteer-guide.md` |
| M6 spec write-back | Done | §2, §4, §5, §19, §20 of the spec |
| M6 release | Pending | CI green on the branch; version by release-please |

## Spec criteria (M6)

To be walked through with a test instance signed in through both providers from M0, two
desktops in different workspaces (one managing the Church Library), and a phone, on macOS
and Windows. Fill in the result column.

| Criterion | Automated evidence | Walkthrough result |
| --- | --- | --- |
| 1 Library privacy | `sync.test.ts` “the Church Library”; `versions.test.ts` (a workspace’s version never reaches another) | |
| 15 Role limits | `store.test.ts`, `sync.test.ts` (normal edits make versions, managing edits change the church’s) | |
| 16 Passwordless repeat use | `admin.test.ts` pairing; enrolled devices untouched by the migration (`db.ts` migration 4 adds columns only) | |
| 26 Privileged management | `sync.test.ts` “edits the church’s song in place on a computer of the managing workspace” | |
| 27 Mode conversion | `admin.test.ts`, `versions.test.ts` D36 | |
| 28 Central deletion | `sync.test.ts` “turns a two-version song into the workspace’s own when the church deletes it”; `admin.test.ts` restore | |

## Departures from the plan

- **D27:** sign-in uses no `openid-client`; the three requests are made directly and the ID
  token's signature is not verified, which the token exchange over TLS with PKCE makes safe.
  Its issuer, audience and nonce are checked, and Microsoft's multi-tenant endpoints are
  refused, since administrators are matched by address. The userinfo endpoint fills in a
  missing e-mail address. See `docs/spikes/oidc.md`.
- **D28:** `WORSHIP_Q_ADMINS` adds only addresses that were never administrators, so one
  removed in the app stays removed; `admin add` brings them back.
- **D29:** the device token stays with an approved request until the device first uses it
  (or the request expires), so an answer lost on the way can be polled again. At most three
  requests wait from one address and thirty in all; more are answered 429.
- **D31:** the church's record of a two-version song travels with every page that carries the
  workspace's version, so a computer that joins later gets both versions and the choice.
- **D34:** a church deletion does not break the link between the church's song and a
  workspace's version of it; it only hides the church's version, and the toggle with it, while
  the song is deleted. A restore shows them again, with the workspace's own version in use (the
  draft plan said the version stays independent; the plan and spec now say this). The link breaks only when the deletion becomes
  permanent, which is when the sweep removes the item's files and a restore is refused. A
  lyrics song has no files, so it is never permanently deleted and its link never breaks.
- **D34:** the sweep keeps any file a live item, or one deleted within the retention period,
  still names, such as the deck images a workspace's version shares with a deleted church
  deck. The Deleted list says who deleted an item.
- **D36:** a version set aside for the church's is dropped on conversion with the church's
  record given a new place in the feed, so the workspace's computers let go of it.
- **D31:** `/api/v1/info` also reports `codes`, whether connection codes work for every
  workspace because the instance has no administrator yet; the desktop uses it to choose
  between pairing and a code.
- **M3:** the explanation shown when editing a church song appears whenever such a song has
  unsaved changes, rather than once; it is one line under the title.
- **D32:** unhiding a church song the workspace removed is not offered; the plan noted that
  restoring would also do that. A hidden church song stays hidden until the Church Library
  changes it.
- **M3:** backgrounds carry their origin in the database, but the picker shows no badge for
  the church’s backgrounds.
- **D34:** the sweep runs a minute after the server starts and then daily; the plan said
  daily.

## Known exceptions

- No real OIDC provider has been tried; the deployment guide’s console steps come from the
  providers’ documentation, not from a run (M0).
- The admin pages and the desktop’s pairing and two-version interfaces have no automated
  tests beyond their pure helpers; they await the walkthrough (M6).
- A version 2 desktop that edits a two-version song in the mixed period drops the toggle’s
  value, so that song goes back to the workspace’s version, as D26 accepts.
