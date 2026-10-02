# Consuming a Heroku Watch from outside

The Heroku instances (see [heroku.md](heroku.md)) are only reachable through Cloudflare Access.
A browser signs in with Google; a script, a local Watch or another Hyperwatch process can't, so it
authenticates with an Access **service token** instead.

Every instance exposes its enriched logs as JSON on a websocket, `/logs/<node>` (`main`, `api`,
`frontend`, `graphql`, `slow`, …), which Hyperwatch's websocket input parses by default. The CSV
and JSON endpoints (`/addresses.csv`, `/history/main.json`, …) work the same way.

## Two layers

| Layer                                | Credentials                                                                  | Missing or wrong                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Cloudflare Access                    | headers `CF-Access-Client-Id`, `CF-Access-Client-Secret`                     | `302` to the Access login page (`ws`: `Unexpected server response: 302`) |
| Watch's Basic Auth (`basic-auth.js`) | `WATCH_USERNAME` (default `opencollective`) / `WATCH_SECRET` of the instance | `401`                                                                    |

Production (`watch.opencollective.com`) has both. Staging has no `WATCH_SECRET` (so no Basic
Auth) and, as of 2026-10-02, no Service Auth policy: only the Google login gets in.

## Setting it up

1. **Service token:** Zero Trust → Access controls → Service credentials → Service tokens →
   create one per consumer (e.g. `<name>-watch-consumer`), with an expiry. The Client Secret is
   shown only once: store it in the consumer's config (`CF_ACCESS_CLIENT_ID`,
   `CF_ACCESS_CLIENT_SECRET`).
2. **Policy:** add the token to the reusable **"Watch services"** policy (action _Service Auth_),
   attached to the instance's Access application (`oc-prod-watch`; for staging, attach it to
   `oc-staging-watch` first). Keep it separate from "Watch engineers": an _Allow_ policy needs a
   user identity and rejects service tokens.
3. **Basic Auth:** give the consumer the instance's `WATCH_SECRET`
   (`heroku config:get WATCH_SECRET -a oc-prod-watch`, never printed).

## Using it

Endpoints, with `curl`:

```sh
curl -s -u "$WATCH_USERNAME:$WATCH_SECRET" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  'https://watch.opencollective.com/addresses.csv?sort=count15m&limit=20'
```

Stream, as an input of another Hyperwatch pipeline. The websocket input adds the Basic Auth
header itself from `username` / `password`, on top of the `options.headers`:

```js
const { input, pipeline } = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const websocketInput = input.websocket.create({
  name: 'Watch production',
  type: 'client',
  address: `wss://watch.opencollective.com/logs/main?clientId=${uuid.v4()}`,
  reconnectOnClose: true,
  heartbeatInterval: 10000,
  username: process.env.WATCH_USERNAME || 'opencollective',
  password: process.env.WATCH_SECRET,
  options: {
    headers: {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    },
  },
});
pipeline.registerInput(websocketInput);
```

For a one-off look without a token, `cloudflared access login https://watch.opencollective.com`
then `cloudflared access curl …` use your Google session (Basic Auth still applies on production).

## Things to keep in mind

- **The token opens everything** on the hostnames its policy covers: Watch has no per-endpoint
  permissions. Give it an expiry, one token per consumer, and revoke it when no longer needed.
- **Unique `clientId`** per connection: a Hyperwatch server terminates a second connection with
  the same `clientId`.
- **Double enrichment:** incoming logs already carry `identity`, `geoip`, `hostname`, …; the
  consumer's modules run again. Harmless, but the costly ones (`hostname`, `geoip`) can be
  disabled there.
