# Worship Q link router

Static files for `app.worship-q.com` ([native apps plan](../../docs/native-apps-plan.md), "The link router"): the two association files and the invitation page at `/j`.

An invitation link is `https://app.worship-q.com/j#s=…&w=…&l=…&i=…&f=…&a=…&p=…`. Everything is in the fragment, which browsers never send, so the server never sees church data. With the app installed, the link opens it. Without, the page shows which church the invitation is for and offers **Continue to** that church's phone page, or says the presentation needs the app when the invitation names no server. It never forwards on its own, and it loads nothing. Building and reading links is `packages/protocol/src/invitation.ts`; the page's words are in `src/j/words.ts`, with the store links, empty until the apps are published.

No QR code points here yet: the desktop's router links stay switched off (`ROUTER_LINKS` in `apps/desktop/src/app/inviteLink.ts`) until the apps are in the stores.

## Build

```bash
pnpm --filter @worship-q/router build
```

This writes `dist/`: the files in `public/`, and `j/index.html` with its script inside, because the page's Content-Security-Policy allows only inline scripts. `pnpm --filter @worship-q/router dev` serves the page locally; open `/j/#s=church.example.org&w=1&i=1`.

## Before the public release

- `assetlinks.json` holds the fingerprint of **one development computer's Android debug key**. Before release, replace it with the **app signing key certificate** from Play Console (Test and release, App signing), which exists once the first build is uploaded, and add the upload key's only if testers install builds signed with it.
- Fill in the store links in `src/j/words.ts`.
- `apple-app-site-association` is final: it names the release app identifier.

## Deploy

The path is DNS → CloudFront → nginx, as for the [public server](../../docs/public-server-rollout.md), with its own distribution and origin name, because the public server's CloudFront behavior does not pass the viewer's host name.

In the commands below, `<host>` is the server's SSH login and `<router root>` is the folder nginx serves the files from.

1. **Origin DNS.** Point `origin.app.worship-q.com` at the public server's host.
2. **Origin secret.** Make a new long random value and keep it in the password manager.

   ```bash
   openssl rand -base64 36
   ```

3. **Files.** From the repository root, build, then copy the contents of `dist/`, including the hidden `.well-known` folder. Add `--rsync-path="sudo rsync"` if `<router root>` needs root to write.

   ```bash
   pnpm --filter @worship-q/router build
   rsync -av --delete apps/router/dist/ <host>:<router root>/
   ```

   nginx must be able to read the files. If `<router root>` is inside a home folder, which recent Ubuntu makes `750`, let nginx pass through the folders above it, then check:

   ```bash
   chmod o+x <each folder above router root> && chmod -R o+rX <router root>
   sudo -u www-data test -r <router root>/j/index.html && echo ok || echo blocked
   ```

4. **Certificate.** Add only the port 80 block of [nginx.conf.example](nginx.conf.example) first, because nginx will not start the 443 block without a certificate.

   ```bash
   sudo mkdir -p /var/www/certbot
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --webroot -w /var/www/certbot -d origin.app.worship-q.com
   ```

5. **nginx.** Add the 443 block with your values, then test and reload.

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. **CloudFront.** Create a distribution:
   - Alternate domain name `app.worship-q.com`, with an ACM certificate for it in **us-east-1**.
   - Origin: `origin.app.worship-q.com`, HTTPS only, TLSv1.2, with the custom header `X-Origin-Verify: <router origin secret>`.
   - Allowed methods GET and HEAD; redirect HTTP to HTTPS.
   - Cache policy `CachingDisabled`; origin request policy `AllViewerExceptHostHeader`; no response headers policy, because nginx sets them.
   - Standard logging and real-time logs **off**.
   - WAF on, with monitor mode **off** and rate limiting on. Afterwards, turn off **sampled requests** in the web ACL's visibility settings, because samples keep visitors' IP addresses for a few hours.
7. **Public DNS.** Point `app.worship-q.com` at the distribution.

## Check

Each of these should answer `200` with `application/json`, and no redirect:

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type} redirects=%{num_redirects}\n' https://app.worship-q.com/.well-known/apple-app-site-association
```

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type} redirects=%{num_redirects}\n' https://app.worship-q.com/.well-known/assetlinks.json
```

The invitation page should answer `200` with `text/html`. Open `https://app.worship-q.com/j#s=church.example.org&w=1&i=1` in a phone browser without the app: it should name `church.example.org` and offer to continue.

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://app.worship-q.com/j
```

The origin should refuse a request without the secret with `403`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://origin.app.worship-q.com/j
```

Apple serves the association file through its own CDN, which can take a while to pick up a new file. See what it holds with:

```bash
curl -sS https://app-site-association.cdn-apple.com/a/v1/app.worship-q.com
```

Google's view of the Android association:

```bash
curl -sS 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.worship-q.com&relation=delegate_permission/common.handle_all_urls'
```
