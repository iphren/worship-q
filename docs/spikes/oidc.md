# Spike M0 — Administrator sign-in through the church's provider

**Status:** not yet run against a real provider. The sign-in code for M1 (`apps/server/src/oidc.ts`)
was written against the OpenID Connect Core and Discovery specifications and passes its tests
against an issuer started in the same process (`oidc.test.ts`), but it has not been tried
against Microsoft Entra ID or Google Workspace, nor behind a reverse proxy and CloudFront.
Each item lists what to confirm and where the result goes.

## Choices made for M1

| Concern | Choice | Why |
| --- | --- | --- |
| Flow | Authorization Code with PKCE (S256), `scope=openid email profile`, `state` and `nonce` kept server-side for ten minutes | Decision D27; works for both providers; no implicit flow |
| Library | None: discovery, the token exchange and userinfo are three `fetch` calls | Three requests do not need a dependency, and the tests can run the whole flow in-process |
| ID token | Read, not verified by signature. It arrives from the provider's token endpoint over TLS in exchange for a code bound by PKCE to this server, which is what makes it trustworthy | Avoids a JWT library and key fetching; the nonce is still checked when the token carries one |
| E-mail | `email` from the ID token, else `preferred_username` when it looks like an address, else the userinfo endpoint | Entra ID leaves `email` out of the ID token unless the `email` claim is configured; userinfo has it |
| Verified | An `email_verified: false` claim refuses sign-in; an absent claim is accepted | Entra ID sends no `email_verified`; Google does |
| Session | Cookie `wq_admin`, `HttpOnly`, `SameSite=Lax`, `Secure` behind HTTPS, idle eight hours, only the hash kept | D27 |
| Admin routes | Need the `x-worship-q-admin` header besides the cookie | D35: a cross-site form cannot add a header |
| Issuer check | The discovery document's `issuer` must match the configured one, except Microsoft's `{tenantid}` placeholder | The `common` and `organizations` endpoints answer with a placeholder issuer |

## M0.1 — Microsoft Entra ID

Register an application in the tenant: **App registrations → New registration**, platform
**Web**, redirect URI `https://<server>/auth/callback`; add a client secret; under **Token
configuration** add the optional claim `email` to the ID token (or confirm that
`preferred_username` is the address). Set:

```
WORSHIP_Q_OIDC_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
WORSHIP_Q_OIDC_CLIENT_ID=<application (client) id>
WORSHIP_Q_OIDC_CLIENT_SECRET=<secret value>
WORSHIP_Q_PUBLIC_URL=https://<server>
```

- [ ] `/.well-known/openid-configuration` is fetched and the issuer matches, with the tenant
      id in the configured issuer (not `common`).
- [ ] Sign-in from the admin app lands back on `/admin/devices` with the cookie set.
- [ ] The e-mail address the server sees is the one listed as administrator (record which
      claim carried it).
- [ ] A user of the tenant who is not on the list sees **not an administrator**.
- [ ] Record screenshots of the registration pages for the deployment guide.

## M0.2 — Google Workspace

In Google Cloud: **APIs & Services → Credentials → OAuth client ID**, type **Web
application**, authorised redirect URI `https://<server>/auth/callback`; configure the OAuth
consent screen as **Internal** so only the Workspace's users can sign in. Set:

```
WORSHIP_Q_OIDC_ISSUER=https://accounts.google.com
WORSHIP_Q_OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
WORSHIP_Q_OIDC_CLIENT_SECRET=<client secret>
WORSHIP_Q_PUBLIC_URL=https://<server>
```

- [ ] Sign-in works and `email_verified` is true.
- [ ] A personal Google account is refused by the consent screen when it is **Internal**;
      otherwise it reaches the server and is refused as not an administrator.

## M0.3 — Behind the reverse proxy and CloudFront

- [ ] The `Set-Cookie` header reaches the browser through CloudFront (the `AllViewerExceptHostHeader`
      origin request policy forwards cookies; confirm the cache policy does not strip them).
- [ ] `request.protocol` is `https` behind the proxy (`trustProxy` is on), so the cookie is
      marked `Secure`; confirm by reading the header in the browser's developer tools.
- [ ] `/auth/*`, `/admin/*` and `/api/v1/admin/*` pass through without caching.
- [ ] The pairing link in the desktop's QR code uses `WORSHIP_Q_PUBLIC_URL`, not the
      container's address.

## Exit

Record what each provider sent and what had to be configured in the console, then move the
steps into the deployment guide's **Administrator sign-in** section and remove the
"not yet tried" note there.
