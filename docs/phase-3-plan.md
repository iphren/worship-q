# Worship Q — Phase 3 Plan: Church Administration

**Drafted:** 2 November 2026  
**Status:** Done. Implemented on branch `phase-3` (2 November 2026), released, and accepted on 3 November 2026 after the sign-in spike (M0) and the walkthrough (M6); see the [acceptance record](acceptance/phase-3.md) for the evidence and the departures from this plan. Revised the same day it was drafted: **Share with church** (a review queue for an administrator) is dropped; a song with a church version and a workspace version instead shows both, and the workspace chooses which to use (D31–D33).  
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md), referred to here as "the spec"; section 7 of the [Phase 2 Plan](phase-2-plan.md), which named this phase; decision U11 of the [Media Uploads Plan](media-uploads-plan.md); and the code at version 1.1.1.

## 1. Where the implementation stands

Phase 2 shipped as 1.0.0 on 1 November 2026. Every desktop of a workspace shares one live state, phones and browser outputs reach it through the server or the venue network, and the live state survives the loss of the presenting computer. The church server runs as one container, and everything an administrator does is a command inside that container.

### What phase 3 builds on

| Area | What exists |
| --- | --- |
| Administration | `node dist/cli.js` in the container: create and list workspaces, replace a connection code, turn **Manage Church Library** on or off with a dry run, list and revoke devices, show and set church defaults, import legacy songs |
| Enrollment | A connection code per workspace, hashed on the server. Anyone with the code and the server address joins the workspace from **Settings → Church connection** |
| Church Library | `church_record` on the server; a workspace record with the same kind and key is that workspace's own version and replaces the church's in that workspace only. A workspace record with `removedAt` set hides the church's item there |
| Mode conversion | `Instance.libraryPlan` says what turning **Manage Church Library** on would do by title; `setManageLibrary` merges the workspace's songs and backgrounds into the Church Library and `moveFilesToChurch` moves their files. Management is now per type (songs, backgrounds, slides, websites): `setLibraryTypes`, and `takeFromChurch` for the reverse |
| Central deletion | A workspace that manages the Church Library removes a song or background by pushing it with `removedAt`, which the server stores as the church's. Workspaces with their own version never receive it, so their version stays, as spec §5 requires |
| Files | One folder per workspace and one for the church under `files/`; `findFile` looks in both. Nothing ever deletes a background file or a deck image |
| Device revocation | `Instance.revokeDevice` plus `Relay.deviceRevoked`, which closes the device's socket at once |
| Bundled web pages | `apps/remote` and `apps/output` are Vite apps built into the Docker image and served by Fastify under `/remote/` and `/output/` |

### Gaps

The first five are the ones the phase 2 plan assigned to this phase. The rest were found while reading the code for this plan.

| # | Gap | Spec |
| --- | --- | --- |
| G8 | **Enrollment uses a shared connection code.** Anyone with the code joins the workspace; nobody approves the computer, names it or sees who asked | §4 permanent pairing, criterion 16 |
| G9 | **No admin web app and no OIDC sign-in.** Administration needs shell access to the server | §2, §4 |
| G11 | **No Share with church.** Deliberately not built: see D33. The spec should record it as a decision rather than treat it as work, as the phase 2 plan did for G19 | §5, criterion 21 |
| G12 | **A workspace's version of a church song hides the church's.** An operator who edits a church song gets a workspace version silently, never sees the church's version again, cannot go back to it, and does not learn when the church changes it | §5 |
| G13 | **Central deletion is not recoverable, and files stay.** A deleted church song or background is a record with `removedAt`; nothing restores it, no administrator sees it, and its file remains on disk for ever | §5, §11 |
| G23 | **The desktop cannot tell a church song from its own.** Pulled records carry no origin, and the song table has no column for one. The server's `pull` leaves out a church record wherever the workspace has its own version, so the desktop never holds the church's copy of a song it changed. G12 needs this | §5 ownership and visibility |
| G24 | **The conversion warning exists only on the command line.** The spec asks for the administrator to see the affected resources and confirm; `libraryPlan` lists them, but not which overrides are of church songs that changed since | §5 mode transitions |
| G25 | **No view of server storage.** The media uploads plan (U11) puts it in the admin web app | media plan U11 |
| G26 | **The live state mirrored to the server is invisible.** The coordinator sends its snapshot to the server on every change (phase 2 D17) and the server keeps it until expiry, but nothing shows it except a desktop of that workspace. Someone away from the venue cannot see whether a service is running or what is on screen | §7 rule 9, §4 device administration |

## 2. Phase 3 goal

A church administrator with no shell access to the server can, from a browser:

1. sign in with the church's Microsoft 365 or Google Workspace account, and be an administrator only because another administrator made them one;
2. approve a new computer into a workspace from a code shown on that computer, name it, and later see and revoke every device;
3. turn **Manage Church Library** on for a workspace after seeing what it changes;
4. see what was deleted from the Church Library and bring it back within a retention period, after which its files are removed;
5. set church defaults and see how much space the server uses;
6. see each workspace's live presentation as the server last heard of it: who is presenting, which run sheet, what is on screen, and which devices follow.

And an operator in a normal workspace can see which songs are the church's and which are the workspace's own, and when a song has both a church version and a workspace version, see both and choose which one the workspace uses.

This covers G8, G9, G12, G13, G23, G24, G25 and G26, which together are spec criteria 1, 15, 16, 26, 27 and 28 as far as they concern administration. G11 is closed by decision, not by code. The remaining gaps stay in section 7.

## 3. Scope

| In phase 3 | Not in phase 3 |
| --- | --- |
| Admin web app (`apps/admin`) served by the church server, with OIDC sign-in | More than one OIDC provider per instance |
| Administrator list; the first administrator named by the person deploying the server | Fine-grained operator permissions (spec §20 item 1) |
| Administrator-approved pairing; connection codes retired per workspace | QR joining links through app.worship-q.com (G15); typing the server address stays |
| Device administration: list, rename, revoke, pending requests | One enrollment covering several workspaces; a computer keeps several workspace folders, each enrolled on its own |
| Record origin on the desktop; both versions of a song kept, with a toggle | **Share with church**: submission, review, approval (G11, D33) |
| Recoverable central deletion with a retention period and file removal | Conflict review for concurrent edits (G14) |
| **Manage Church Library** in the admin app, with the conversion warning | Per-override confirmation during conversion (spec: Later) |
| Church defaults and the storage monitor in the admin app | Removing content from the storage page (U11 says view only) |
| A read-only view of each workspace's live state from the server's copy | Controlling or ending a presentation from the admin app; a live slide preview |
| The command line kept as the recovery path | Phone app, Linux, live audio (phase 4 and unscheduled) |

## 4. Decisions needed before or during phase 3

These continue the phase 2 numbering. Each one has a recommendation so work can start.

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D26 | Protocol version | Raise `PROTOCOL_VERSION` to 3 and leave `MIN_PROTOCOL_VERSION` at 2 on both sides. Everything phase 3 adds to the device protocol is additive: pulled records gain an `origin`, `/api/v1/info` gains `pairing`, and new routes appear. The live-state protocol does not change, so a version 2 desktop presents alongside a version 3 one; it only lacks the badges and the toggle until it updates. Two rules make this hold in practice. **Server:** shadows and origins (D31) go only to requests whose protocol header is 3 or more; the wire schema strips unknown fields, so a version 2 desktop given a shadow would apply it as the song itself. **Desktop:** it reads `/api/v1/info` when it connects and speaks the server's version when that is within its own range, so a desktop that updates before its church's server keeps working as a version 2 client and offers pairing and the toggle only once the server does. Today the desktop sends a fixed version and the server refuses a higher one, which would stop every desktop within six hours of the release if the server was updated later. Two things degrade in the mixed period and are accepted: a version 2 desktop that edits a two-version song drops the toggle's value, so the song goes back to the workspace's version; and a version 2 desktop enrolling by a retired code sees **invalid code** rather than an explanation | M2, M3 |
| D27 | Sign-in | Generic OpenID Connect with discovery, Authorization Code with PKCE, through `openid-client`. One provider per instance, configured by three variables: `WORSHIP_Q_OIDC_ISSUER`, `WORSHIP_Q_OIDC_CLIENT_ID`, `WORSHIP_Q_OIDC_CLIENT_SECRET` (optional, for providers that require one), plus `WORSHIP_Q_PUBLIC_URL` for the redirect address. Sessions are rows in a new `admin_session` table, carried by an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, idle for eight hours at most. Without the variables, the admin app shows that sign-in is not configured and the command line remains the only administration | M1 |
| D28 | Who is an administrator (spec open decision) | An allowlist of e-mail addresses in a new `administrator` table, matched against the provider's verified `email` claim and bound to the provider's `sub` on first sign-in. The first administrator is added by `admin add <email>` on the command line, or by `WORSHIP_Q_ADMINS` (comma-separated) read at start, so a fresh deployment needs no shell after the first start. Administrators add and remove each other in the app; the last one cannot be removed there. Holding an account with the provider grants nothing, as the spec requires | M1 |
| D29 | Pairing protocol | The OAuth device authorization pattern. The desktop asks the server for a pairing (`POST /api/v1/pair`), receives a long random device secret and an eight-character code in the enrollment-code alphabet, shown as `ABCD-2345` with a QR of `<server>/admin/pair?code=ABCD-2345`, and polls every five seconds with the secret. The code lives fifteen minutes. An administrator signs in, sees the request with the computer's proposed name and when it asked, picks the workspace, may rename it, chooses whether the computer may merge its own songs and run sheets into the workspace (no default; when not, it can only take the church's copy, and starts a workspace with no content empty; the admin app warns when the Church Library is empty too), and approves or refuses. The next poll returns the device token and workspace, exactly as `/api/v1/enroll` does today, so the rest of the desktop's join flow is unchanged. The secret never appears in the QR; the code alone grants nothing | M2 |
| D30 | Retiring connection codes | Codes keep working until the instance has an administrator, so no deployment is locked out by the update. Once one exists, every workspace's code is off; an administrator may turn a workspace's code on for a while from its page, and the page says so plainly. Devices enrolled with a code are untouched: their tokens stay valid and the device list shows **Joined with a connection code**. This is the whole migration G8 asks for | M2 |
| D31 | Record origin and two versions | The server marks every pulled record `origin: 'church' \| 'workspace'`. Where a workspace has its own version of a church song, the pull sends **both** records instead of leaving the church's out: the workspace's as today, and the church's flagged `shadow: true`. The desktop keeps the church's in a new `church_version` table, keyed by song identifier, and updates it on every later church edit, so both versions are always the latest. A song is then one of: the church's, the workspace's own, or a song with two versions. Backgrounds have no versions (spec §11): a background is the church's or the workspace's, and the hiding rule stays as it is | M3 |
| D32 | Which version is used | The choice is per workspace and per song: each two-version song has its own toggle, and each workspace makes its own choice for it, so Workspace A can use its version of a song while Workspace B uses the church's. It is stored as `useChurchVersion` on the workspace's song record, so it synchronizes like any edit and every desktop and phone of that workspace resolves the song the same way. Nothing is chosen for the workspace as a whole. Run sheets refer to the song identifier, which both versions share, so the choice changes what is presented without touching any run sheet. Default after an edit is the workspace's version, as the spec's override behaviour expects. Editing while the church's version is in use edits the workspace's version and switches the choice to it; the church's version is never edited from a normal workspace. **Delete our version** removes the workspace's record, leaving the church's alone; that replaces the spec's **Restore central version**. The spec's **Central version updated** notice is not needed: the toggle shows each version with when it was last changed | M3 |
| D33 | No Share with church | Not built. A review queue is more process than a church of this size wants, and the two routes that already exist cover what it was for: a workspace that manages the Church Library writes to it directly, and a workspace that does not keeps its songs its own. If a song written in a normal workspace should become the church's, an operator of the managing workspace adds it there. The spec's §5 sharing workflow and the **Share with church** label in §2 should be recorded as not adopted, and criterion 21 reduced to: workspace media stays private until conversion to a managing workspace | — |
| D34 | Recoverable deletion | Deleting from the Church Library, by a managing workspace or by an administrator in the app, keeps setting `removedAt` on the church record; that is the recoverable state. The admin app lists deleted items with when and from where, and **Restore** clears `removedAt` with a revision bump so every workspace receives it again. A workspace's version stays linked to the church's song through the deletion: while deleted, the church's version and the toggle are hidden, and a restore shows them again with the workspace's own version in use. The link ends only when the deletion becomes permanent (revised during implementation; the draft said a restore does not reconnect, after spec §5). After a retention period of 90 days (`WORSHIP_Q_RETENTION_DAYS`) a daily sweep removes the files of still-deleted backgrounds and decks; the record stays, so a restore after that shows **Files were removed** and offers nothing else. Workspace-private deletions follow the same sweep for their files | M4 |
| D35 | Admin app packaging | `apps/admin`: a Vite and React app like `apps/remote`, built into the Docker image and served under `/admin/`. Its API lives under `/api/v1/admin/` and `/auth/`, authenticated by the session cookie, not a device token; the routes refuse requests without the `x-worship-q-admin` header so a cross-site form cannot reach them, and CORS stays as it is for `/api/v1/*`. The command line keeps every command it has, and gains `admin add`, `admin list`, `admin remove`, so a church that loses its provider or its last administrator can recover | M1 |
| D36 | Conversion warning | The admin app shows `libraryPlan` before turning **Manage Church Library** on, grouped as the spec asks: songs and backgrounds that become the church's, church songs the workspace's version will replace church-wide, and hidden items that reappear. Overrides whose church song changed after the workspace's version was made are flagged, comparing the two records' timestamps. The administrator confirms the whole conversion; per-song choice stays Later. A song whose workspace had chosen the church's version (D32) is not an override for this purpose: its workspace version is dropped by the conversion, not promoted | M5 |
| D37 | Admin deletion | Administrators delete songs and backgrounds from the Church Library in the app, the same recoverable way a managing workspace does; the page shows which workspaces' run sheets use the item first, from the `runSheet` records the server already holds | M4 |
| D38 | Live state in the admin app | Read-only, from what the server already holds: `Instance.getLive` (the snapshot, grants and when it last arrived) and the relay's knowledge of whether the coordinator is connected now. The workspace page shows **Live now** or **Not presenting**, and when live: the coordinator's name and whether it is connected or last seen when, the run sheet's date, the presented item and piece as text, blank or not, when the live state started and when it expires without an operator, and the connected devices from the snapshot by name, role and way in. The page polls every five seconds while open; the coordinator's own mirroring is already throttled to one a second (D17), so nothing new flows from the venue. No control: ending or changing a presentation stays with the operator devices. An expired snapshot is deleted on read today, so the page shows nothing stale | M1 |

## 5. Milestones

Sizes are relative (S, M, L), not time estimates. Each milestone ends in something that can be demonstrated.

As in phase 2, there are no releases between milestones: phase 3 ships as one version after M6. Every milestone adds unit tests in its package and integration tests in `apps/server` that run the server with simulated devices. OIDC is tested against a small in-process issuer started by the test, never against a real provider. The admin and desktop interfaces are covered by M6's walkthrough.

### M0 — Sign-in spike (S)

Throwaway code to confirm the riskiest external dependency:

- Register an application in a Microsoft Entra ID tenant and a Google Cloud project, and sign in from a server on a church domain behind the reverse proxy and CloudFront described in the deployment guide, with the session cookie surviving the round trip.
- Confirm which claims each provider sends by default (`email`, `email_verified`, `sub`, `name`), and what Google needs for `hd` restriction if a church wants to limit sign-in to its domain.
- Note the steps a church administrator follows in each console, with screenshots, for the deployment guide.

**Done when:** both providers sign in to a test server, or the gaps are written down in `docs/spikes/oidc.md`.

### M1 — Admin app and sign-in (M)

- `apps/admin`, served at `/admin/` per D35, with the pages: Administrators, Workspaces, Devices, Church defaults, and a sign-in page.
- OIDC per D27, sessions, and the allowlist per D28, including `admin add` and `WORSHIP_Q_ADMINS`.
- Everything the command line does today has an equivalent, except the legacy import and deck conversion, which stay commands: create a workspace, rename it, list and revoke devices, rename a device, show and set church defaults.
- Revoking a device in the app disconnects it at once through `Relay.deviceRevoked`, as the command does.
- `/api/v1/info` reports `admin: true` when sign-in is configured, so the desktop can show the admin address under Church connection.
- The live state of each workspace on its page per D38, from `GET /api/v1/admin/workspaces/:id/live`, which returns the kept snapshot and the relay's view of the coordinator, or **Not presenting**. The workspace list shows a **Live** mark next to a workspace that is presenting.

**Done when:** a fresh container with the four variables set lets the named administrator sign in and create a workspace without any command being run; someone with a provider account who is not on the list is told so and gets nothing; and while a desktop presents, the administrator sees the slide change on the workspace page within a few seconds, and sees **Not presenting** once the live state is ended or expires.

### M2 — Administrator-approved pairing (M)

- Pairing per D29: `pairing_request` table, routes, expiry, and refusal.
- Desktop: **Settings → Church connection** asks for the server address and this computer's name, then shows the code and QR and **Waiting for approval**; on approval it continues into the existing join dialog (**Upload and connect**, **Keep both**, **Use the church's copy**). The connection-code field appears only when the server says codes are on for enrollment.
- Admin app: **Pending requests** on the Devices page, with approve and refuse; `/admin/pair?code=` opens straight to the request after sign-in.
- Code retirement per D30, with the per-workspace switch and the **Joined with a connection code** label.
- Protocol version 3 per D26: the server accepts version 2 desktops, and the desktop speaks the server's version when it is older. The desktop offers pairing when `/api/v1/info` reports `pairing: true`, and shows the code form against an older server. Tests: a version 2 client against the new server, and the new client against a server reporting version 2, both synchronize unchanged.

**Done when:** criterion 16 holds for permanent equipment: a new computer joins only after an administrator approves it; a computer enrolled in phase 2 keeps working untouched; and once an administrator exists the old code is refused.

### M3 — Two versions of a song (M)

- Server: `origin` and shadows in `pull` per D31, sent only to protocol 3 requests per D26; the `useChurchVersion` field accepted in song records and ignored for records in `church_record`. `records()` and `libraryPlan` unchanged, apart from D36's exception. Test: a version 2 pull of a workspace with two-version songs returns exactly what it returns today.
- Protocol: `useChurchVersion` added to `SongFieldsSchema` as optional, so version 2 desktops and the server's existing records parse unchanged.
- Store: `origin` on songs and backgrounds, the `church_version` table, and `useChurchVersion` on songs; a migration that marks every existing record's origin unknown, and one full re-pull from cursor 0 after the update so every record gets its origin and every two-version song gets its church version.
- Session: one place that resolves the song a run sheet item presents, honouring the choice, used by the slideshow, the overlay, the snapshot built for followers, the remote view for phones, and search. Search indexes the version in use.
- Library: a **Church** badge on the church's songs and backgrounds, nothing on the workspace's own, and a **2 versions** badge on songs with both. Editing a church song shows once what happens: **Your changes become this workspace's version. The church's stays as it is, here and for other workspaces.**
- The song page of a two-version song: a toggle, for this song in this workspace, with **Church's version · changed 3 Nov** and **Our version · changed 28 Oct**, a read-only view of whichever is not selected, and **Delete our version** with a confirmation. Changing the toggle is an edit of that song's record and synchronizes like one; other songs and other workspaces are unaffected. A live presentation of that song follows on the next slide change, never mid-slide.
- A workspace that manages the Church Library shows no badges and no toggle: its songs are the church's.

**Done when:** on a desktop in a normal workspace, editing a church song makes a two-version song presenting the workspace's text; switching to the church's version presents the church's text on every desktop and phone of the workspace within a sync cycle; a later church edit shows up on the toggle's date without any action; and **Delete our version** leaves the church's song and every run sheet item working (spec §5 override behaviour, criterion 15).

### M4 — Recoverable central deletion (M)

- Admin app: **Deleted from the Church Library** list with restore per D34, and deletion of church songs and backgrounds per D37 with the affected-workspaces view.
- The retention sweep: a daily job in the server removing files of items deleted longer ago than the retention period, logging what it removed; `WORSHIP_Q_RETENTION_DAYS` in the deployment guide.
- Desktop: a restored church song reappears in every workspace without its own version, and a run sheet item marked **Removed from library** becomes a normal item again. A two-version song whose church version is deleted becomes the workspace's own, and its toggle disappears; a restore within the retention period brings the toggle back, with the workspace's version in use. A lyrics song has no files, so it is never permanently deleted and its link never ends.

**Done when:** criterion 28 holds (a workspace version survives the deletion, and shows both versions again after a restore), a background deleted from the Church Library can be restored on day 89 with its file, and on day 91 the file is gone and the admin page says so.

### M5 — Manage Church Library and storage (S)

- The **Manage Church Library** switch on the workspace page, with the warning per D36 and the flag for overrides of since-changed church songs; the files move as the command does today.
- The storage page per U11: totals and counts by type (deck images, deck originals, images, videos, backgrounds, desktop backups, database), overall and per workspace, with the volume's free space, and how much pruning deck originals would free.

**Done when:** criterion 27 can be exercised entirely from the browser, and the storage page agrees with `du` on the data volume to within the database's WAL size.

### M6 — Acceptance pass (S)

- Walk through spec criteria 1, 15, 16, 26, 27 and 28 with a test instance signed in through both providers from M0, two desktops in different workspaces (one managing the Church Library), and a phone, on macOS and Windows.
- Update the deployment guide: provider registration for Entra ID and Google Workspace, the four variables, the first administrator, code retirement, retention, and the shrunken role of the command line. Update the volunteer guide with the badges and the two-version toggle.
- Spec write-back: record D27 and D28 against the open decisions in §4, D31 to D33 against §5 and the §2 terminology table, criterion 21 as reduced by D33, and the pairing decision in §20 item 6.
- Confirm the package unit tests and server integration tests from M1–M5 pass on the release build.

**Done when:** every listed criterion passes or has a recorded, accepted exception.

## 6. Order and dependencies

| Milestone | Needs first |
| --- | --- |
| M0 | — |
| M1 | M0 |
| M2 | M1 |
| M3 | — |
| M4 | M1 |
| M5 | M1, M3 (for the since-changed flag) |
| M6 | M2–M5 |

- M3 is server and desktop work with no administrator in it, so it can run alongside M0 to M2.
- M1 is the trunk: M2, M4 and M5 are pages added to it and can run in any order once it is in.
- M0 exists because sign-in depends on two consoles outside the project; if either proves awkward behind CloudFront, that is the time to find out.

## 7. Later phases

Unchanged from the phase 2 plan, with additions found here.

**Phase 4 — Phones**

- app.worship-q.com link router and installed-app opening from a camera scan (G15).
- A phone app: Present on this device with swipe navigation, a local-only workspace, remembered **Connect to [workspace]**, and LAN control without internet (G16, G17).
- Cache readiness for offline use (G20).

**Unscheduled**

- Conflict review for concurrent and offline edits, and merging run sheets for the same date on join (G14, G21).
- Linux desktop build (G18).
- Live audio broadcast and voice recognition (spec §17).
- OBS control from every desktop and remote control of the workspace, through the streaming computer's desktop app ([OBS Control Plan](obs-control-plan.md), requested 5 November 2026).
- Record SQLite as the server database in the spec (G19).
- Several OIDC providers per instance, and fine-grained operator permissions (spec §4 open decisions).
- Copying a workspace's song into the Church Library from the admin app, without a review queue, should a church ask for it after D33.
- Automatic server backup of live audio: when any workspace has live audio enabled and is broadcasting, the server saves a recording of the broadcast as it goes.
- Presentation log on the server: a record of what was presented, as a snapshot of the content, with when it started and when it ended.
- A church-server API on localhost, so other services running at the church can read run sheets, the presentation log and the audio recordings.

  These three are broken into tasks in the [Service Records Task Breakdown](service-records-task-breakdown.md).

## 8. Rollout

Phase 3 keeps version 2 desktops working against the new server, and version 3 desktops working against the old one (D26), so the server and the desktops can update in either order. The server update is the only step a church has to take, and it affects it gently.

**Before the server update**

- Register the application with the church's provider following M0's notes, and choose the first administrator's e-mail address. Add the four variables to `apps/server/.env`. Without them the server starts as before, with no admin app.
- Check that the reverse proxy passes cookies and the new paths (`/admin/`, `/auth/`, `/api/v1/admin/`); the CloudFront settings in the deployment guide already do.

**The server update**

- Run `scripts/update-server.sh` early in a week. The server migrates its database on start, adds the first administrator from `WORSHIP_Q_ADMINS`, and starts the retention sweep, which removes nothing for 90 days.
- Connection codes keep working until that administrator signs in for the first time, then stop (D30). Tell the branches beforehand that new computers will ask for approval from now on, and who approves.
- Desktops update themselves within six hours of the release as before, whether or not the server has been updated. Against the old server they behave exactly as version 2 desktops do; against the new one a desktop still on version 2 keeps presenting and synchronizing, and shows no badges and no toggle until it restarts into version 3.

**What the update keeps and what it asks**

- Every enrollment, device token, phone approval, output link and viewer setting is kept. No computer re-pairs.
- The first pull after the desktop update is a full one, so every song learns its origin and every song the workspace changed gets its church version back; a workspace of a few thousand songs takes under a minute on a venue connection.
- Operators see two new things without asking: the **Church** and **2 versions** badges, and the one-time explanation when they first edit a church song. Songs they changed before the update keep presenting their workspace's version; the church's is simply visible again, one toggle away.
