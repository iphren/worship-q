# Privacy

**Last updated:** 20 November 2026

Worship Q is made to know as little about you as it can. There is no account, no tracking in
the app and no advertising. This page says what the Worship Q app, the free Worship Q public
server and this website handle, how long anything is kept, and who else is involved.

**Who we are:** Worship Q and its public server are run by IHS Technology. Questions and
requests about your data: [hello@ihs.technology](mailto:hello@ihs.technology).

## In short

- Your songs, run sheets, recordings and settings stay on your computer, or on your church's
  own server if it has one. They never go to us.
- The public server passes things through and deletes them: a slide deck as soon as your
  computer has its slides, anything else within a day.
- We keep no names, no accounts and no content. Addresses (IP addresses) are logged only when
  the server refuses a request because a limit was reached, and logs are deleted after 14
  days.

## The Worship Q app

The app has no account, no analytics and no crash reporting. What you make in it is kept on
your computer. It uses the internet only for these:

- **Updates:** it asks GitHub whether a new version is out, ten seconds after it opens and
  every six hours after that. GitHub sees your computer's address, as with any download.
- **The public server**, for the features below, when your workspace is not connected to a
  church server.
- **Websites you present** and **Bible versions and services your church configures**, which
  you choose.
- **Live audio:** to find a route between devices, the computer and phones ask a STUN server
  (Google's, `stun.l.google.com`) what their public address is. Google sees that address, and
  nothing of the audio.

**A church server** is run by your church, not by us. What it keeps (songs, backups,
recordings, the presentation log and so on) is your church's to decide; ask whoever runs it.
This page does not cover it.

## The public server

`public.worship-q.com` gives phone control, Bible passages, slide conversion and live audio to
computers without a church server. It runs on Amazon Web Services in London, United Kingdom,
behind Amazon CloudFront.

### What passes through, and how long it stays

| What                                                                                  | Kept                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slide decks, PDFs and photos you import, and the slides made from them                | Until your computer confirms it has the slides, then deleted; anything not confirmed within a day                                                                  |
| Phone control messages, the slide pictures phones show, and the OBS picture on phones | Not stored: relayed while the computer and the phone are both connected                                                                                            |
| Live audio                                                                            | Not stored or recorded: relayed between the computer and at most two listeners. Where a network needs it, it goes through the relay server (TURN) on the same host |
| Bible passages                                                                        | The reference is passed to the Free Use Bible API, which sees our server, not you. The text is held in memory for up to 10 minutes, not linked to you              |
| Songs, run sheets, backups and recordings                                             | Never sent to the public server                                                                                                                                    |

### What it knows about your computer

- **A workspace number and a device key**, both random, made when your computer first uses
  the public server. The key is stored only in a scrambled (hashed) form, with when it was
  last used. Nothing in them names you, your church or your computer. They are deleted once
  the workspace has not been used for 90 days.
- **A random number for this copy of the app**, which your computer sends so that the limits
  (for example 100 slide decks and photos a day) count per copy. It is held in memory only,
  for as long as the limit's period (at most a day), and never written to disk or the logs.
- **Your address**, which every internet request carries. It is held in memory to count the
  limits per address, for at most a day.

### Logs

- The server's log keeps, for each request, the time, what was asked without its details (no
  Bible search or reference) and the answer. It does not keep your address, except for a
  request refused because a limit was reached; that line has the address and which limit.
- The relay server (TURN) logs the address of each device whose audio it relays.
- Logs are deleted after 14 days. No other access logs are kept on the way.

They are kept to keep the service working and to stop abuse, and are not used for anything
else.

## This website

worship-q.com is hosted on GitHub Pages; GitHub keeps its own logs of visits. We use
Cloudflare Web Analytics to count visits: it sets no cookies and does not follow you across
sites, and we see only totals. The website has no forms and no sign-in.

## Who else is involved

| Who                 | What for                                                            | Where                                        |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| Amazon Web Services | Runs the public server and CloudFront, which carries requests to it | London; CloudFront's nearest location to you |
| Free Use Bible API  | Bible passages for the public server                                | Receives our server's requests only          |
| Google              | STUN for live audio                                                 | Your devices ask it directly                 |
| GitHub              | App updates and this website                                        | United States                                |
| Cloudflare          | Visit counts for this website                                       | United States                                |

## The legal part

Under UK data protection law (UK GDPR), IHS Technology is the controller for the public server
and this website. We rely on legitimate interests: providing the service you use, and keeping
it secure and fair for everyone. We do not sell data, profile anyone, or use it for
advertising.

You may ask to see, correct or delete data about you, or object to its use. Since we keep no
names or accounts, we usually cannot tell which data is yours; write to
[hello@ihs.technology](mailto:hello@ihs.technology) and we will help as far as we can. A
workspace you stop using is deleted after 90 days in any case. You may also complain to the
[Information Commissioner's Office](https://ico.org.uk/make-a-complaint/).

When this page changes, the date at the top changes with it.
