# Worship Q — AI Assistants (MCP) Plan

**Drafted:** 28 November 2026  
**Status:** Implemented on branch `claude/mcp-church-run-sheets-ytk6ox`; not yet released or accepted. Media (slide decks, images and videos) is left for later (§5).  
**Source:** the project owner's request of 28 November 2026: coworkers should be able to update run sheets from their own ChatGPT or Claude, for example by pasting a screenshot of a WhatsApp message with the week's songs. The code at version 2.15.0.

## 1. Why

The songs for a service usually arrive as a chat message ("here are the songs for this Saturday"). Someone then types them into the desktop app: they find each song, add the ones the library does not have, and put them on the right date. Announcements and readings are repeated from last week. An AI assistant can read the message and do the typing, if it can reach the church server's run sheets and songs.

The church server gains an [MCP](https://modelcontextprotocol.io) endpoint. A coworker adds it as a custom connector in ChatGPT or Claude, signs in with their church account, and then asks in plain words.

## 2. Features

- **MCP endpoint** at `https://<server>/mcp` (Streamable HTTP), for ChatGPT, Claude and any other MCP client.
- **Sign-in** with the church's existing OpenID Connect provider, through an OAuth 2.1 authorization server on the church server. Assistants register themselves. The person confirms each connection on a consent page that names the assistant, their account and the workspaces it will reach.
- **MCP users** tab in the admin app: who may connect an assistant, and which workspaces each person's assistant reaches (chosen ones, or all of them including new ones). It also shows when each person last used an assistant and how many are connected, and has **Sign out assistants**. The command line gains `mcp-user add`, `mcp-user list` and `mcp-user remove`.
- **Tools:**
  - `list_workspaces`, which gives today's date and the next meeting date in each workspace's timezone;
  - `list_run_sheets`, `get_run_sheet`;
  - `search_songs`, `match_songs` (a batch of titles from a message, each `exact`, `likely` or `none`), `get_song`;
  - `create_song`, `update_song`;
  - `add_to_run_sheet` (songs, Bible passages and websites), `move_run_sheet_item`, `remove_run_sheet_items`;
  - `copy_run_sheet_items` ("announcements like last week").

## 3. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| C1 | Who may connect | A new list, `mcp_user`, separate from `administrator`. Being an administrator grants nothing here, and an MCP user cannot sign in to the admin app. Each user reaches a list of workspaces or all of them (`all_workspaces`, which includes workspaces made later). There is no separate view-only level: anyone who can connect can view and edit in their workspaces. Access is read on every request, so a change or removal applies to the next tool call. Removing a user signs out their assistants. |
| C2 | Authorization server | The church server is the OAuth 2.1 authorization server for MCP clients, as the MCP specification describes. It provides protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client registration (RFC 7591), PKCE with S256 only, and rotating refresh tokens (RFC 9700); a refresh token used twice ends its family. Access tokens are opaque, last an hour, and are stored only as SHA-256 hashes, like device tokens. Church identity providers do not offer dynamic registration, which is why the server issues the tokens itself. Written with no OAuth library, as OIDC was (D27). |
| C3 | Sign-in and consent | The authorization sends the person to the church's provider through the existing `/auth/callback`, so the provider needs no second redirect address. The `auth_state` row says whose sign-in it is. Every assistant signs in under the server's one client at the provider, so a consent page (HttpOnly cookie plus a form secret, no framing) always asks the person before a code is issued. An unverified e-mail address, a subject other than the one bound before, or a person who is not an MCP user is refused, exactly as for administrators (D28). |
| C4 | Registration limits | Redirect addresses must be `https`, or `http` to `localhost` or `127.0.0.1` for local clients. Registration is limited to 20 an hour from one address, at most 500 clients are kept, and clients unused for 90 days are forgotten (they register again). |
| C5 | Transport | `@modelcontextprotocol/sdk`, stateless Streamable HTTP with JSON responses (`WebStandardStreamableHTTPServerTransport`): no sessions, and no streams to keep open behind the proxy. On only when sign-in is configured, never in public mode, and `WORSHIP_Q_MCP=0` turns it off. |
| C6 | How writes reach desktops | Through `Instance.push`, as a desktop's push does, then the relay tells the workspace's devices to synchronize (`contentChangedAll` when the Church Library changed). Records carry `mcp:<user id>` as their device. Timestamps are set past the stored record's, so a desktop with a clock running fast does not quietly win. A new run sheet starts at revision 2, so it is not taken for one a device only opened. Existing item identifiers are kept. |
| C7 | Songs | New songs are checked like a desktop's edits (`cleanSongFields`, CCLI digits, a year no later than next year) and get line identities. A title already in the library, compared in either Chinese script with case, spaces and punctuation set aside, is refused unless `allowDuplicate`. Edits need the revision the assistant read (`expectedRevision`), so an edit made meanwhile is never overwritten unseen. Line identities are kept for unchanged lines. Only songs of lyrics can be edited. Editing a church song in a workspace that does not manage songs makes the workspace's own version (D31), and the result says so. |
| C8 | No deletion from the library | Assistants never delete songs. `remove_run_sheet_items` only takes items off a run sheet. |
| C9 | Run sheet changes | All or nothing: every item of an `add_to_run_sheet` is checked, and passages fetched, before anything is written. Positions are `start`, `end` or "after this item". Passages use the workspace's Bible versions, else the church's default, and only versions the church offers; API.Bible usage is reported (B25). A website already in the library is reused. Copies are new items pointing at the same songs, as the desktop's copy makes them. |

## 4. Business rules and edge cases tested

- `apps/server/src/mcp/content.test.ts`:
  - **Workspace reach:** by id or name; out of reach reads as not found; changes and removal apply at once; "all workspaces" includes ones made later; today is in the workspace's timezone.
  - **Songs:** duplicates across scripts and punctuation; validation; search leaves out passages, deleted songs and hidden church songs; matching levels.
  - **Edits:** revision conflicts; no-ops; line identities kept; a workspace version of a church song; the managing workspace editing the church's song; refusing passages, websites, slides and deleted songs; continuing past the song's history.
  - **Run sheets:** new dates; positions; all-or-nothing; clock skew; live flag; moves; removals; copies.
  - **Passages:** version choice, versions not offered, each way a fetch fails, usage reporting.
  - **Websites:** address completion, reuse, refusals.
- `apps/server/src/mcp/route.test.ts`:
  - discovery and the `WWW-Authenticate` challenge;
  - registration limits;
  - the whole authorization, including an administrator who is not an MCP user, an unverified address, another subject, a removed user, denial and forged consent;
  - redirects never going to an unregistered address;
  - PKCE;
  - codes (single use, expiry, wrong verifier, client or address);
  - refresh rotation and reuse;
  - expiry, revocation and confidential clients;
  - tool listing, tool errors, schema refusals, and access changing between calls;
  - the endpoint missing without sign-in, when turned off, and in public mode.
- `apps/server/src/mcp/access.test.ts`: the store on its own, and the migration from the database before it.
- `apps/server/src/admin.test.ts`: the MCP users routes need an administrator; an administrator is not an MCP user, and an MCP user is not an administrator; validation; signing assistants out.

## 5. Later

- **Media:** add slide decks, PDFs and images from a public link, once the upload helpers (`makeDeck`) are lifted out of `buildServer`. Videos also need ffprobe in the image to read their size and length. Chat apps do not hand a pasted file's bytes to an MCP tool, so a link is the practical way in.
- Deleting songs from the library, if a church asks for it, as the same recoverable deletion (D34).
- A view-only level per person.
- Client ID Metadata Documents, the newer alternative to dynamic registration, once the assistants rely on them.
