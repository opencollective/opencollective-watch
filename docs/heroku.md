# Running Watch on Heroku (staging)

Watch runs on Heroku as **`oc-staging-watch`**, plugged into the **staging** servers. It is not
public: the only way in is a Cloudflare Tunnel protected by Cloudflare Access (Zero Trust), the
same pattern as our Metabase (`oc-metabase`). Production is not deployed yet.

## How it works

```
staging servers (api, frontend, images, rest)
        │  wss://…/_hyperwatch/logs/raw (basic auth)
        ▼
oc-staging-watch — one worker dyno, no web process
  bin/start-heroku
   ├─ node start.js --stderr      4 Hyperwatch processes on localhost
   │    api :3360  frontend :3300  images :3301  rest :3303
   └─ cloudflared tunnel run      outbound connection to Cloudflare
        │
        ▼
Cloudflare Tunnel "oc-staging-watch" ── Cloudflare Access (Google login, allow-list)
        │
        ▼
https://watch-staging-{api,frontend,images,rest}.opencollective.com
```

- **No `web` process**, so Heroku never exposes Watch on `*.herokuapp.com`. The Node buildpack
  adds a default `web: npm start` process type: it must stay scaled to **0**.
- `bin/start-heroku` runs Watch and `cloudflared` side by side. If either exits, it stops the other
  and exits non-zero so Heroku restarts the dyno. `start.js` also stops everything if one
  Hyperwatch process dies.
- `cloudflared` is downloaded at build time by `bin/install-cloudflared` (`heroku-postbuild`).
  Set `CLOUDFLARED_VERSION` to pin a release (latest by default).
- One tunnel publishes one hostname per service, each routed to that service's localhost port.
  Anything else gets a 404.

## Accessing it

Open `https://watch-staging-<service>.opencollective.com` (`api`, `frontend`, `images`, `rest`)
and sign in with Google. Sessions last 24h. Access is an allow-list: ask an admin to add your email
to the **"Watch engineers"** Access policy (Cloudflare Zero Trust → Access controls → Policies).

Useful pages on each hostname:

| Page                                                   | What                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `/status`                                              | pipeline status, inputs connected                                                    |
| `/logs/<node>`                                         | live stream, one line per request (`main`, `without-identity`, `slow`, `graphql`, …) |
| `/history/<node>.json?limit=50`                        | last requests (up to 1000 per node); filters `address`, `identity`, `signature`      |
| `/addresses`, `/identities`, `/signatures`, `/graphql` | aggregated views; add `.csv` or `.json`                                              |

## Logs

- `heroku logs --tail -a oc-staging-watch`: Watch's own logs. Only **stderr** of the Hyperwatch
  processes (`start.js --stderr`), plus `cloudflared`. Per-request lines are not sent to Heroku on
  purpose; use `/logs/<node>` above. Heroku keeps ~1500 lines, there is no log add-on.
- Expected noise: `cloudflared` "ICMP proxy feature is disabled" at boot, and `unexpected EOF`
  lines when the dyno restarts while someone has a `/logs` page open.

## Configuration

| Variable                                       | Value                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<SERVICE>_HYPERWATCH_URL`                     | `wss://<staging host>/_hyperwatch/logs/raw`. Hosts: `opencollective-staging-api.herokuapp.com`, `frontend-staging.opencollective.com`, `images-staging.opencollective.com`, `rest-staging.opencollective.com` |
| `<SERVICE>_HYPERWATCH_USERNAME`                | `opencollective` (the servers' default, `api/config/default.json`)                                                                                                                                            |
| `<SERVICE>_HYPERWATCH_SECRET`                  | the `HYPERWATCH_SECRET` of the matching staging app                                                                                                                                                           |
| `API_/FRONTEND_/IMAGES_HYPERWATCH_CONNECTIONS` | `1` (see below)                                                                                                                                                                                               |
| `CLOUDFLARE_TUNNEL_TOKEN`                      | token of the `oc-staging-watch` tunnel                                                                                                                                                                        |
| `HYPERWATCH_PERSISTENCE`                       | **not set**: the dyno disk is wiped on every restart/deploy                                                                                                                                                   |

`<SERVICE>` is `API`, `FRONTEND`, `IMAGES` or `REST`.

Copy a secret without printing it:

```sh
heroku config:set -a oc-staging-watch \
  API_HYPERWATCH_SECRET="$(heroku config:get HYPERWATCH_SECRET -a opencollective-staging-api)" > /dev/null
```

### Connections per service

Each websocket gets the logs of the one server dyno Heroku's router picked, and the servers don't
deduplicate by `clientId`. The defaults (api 2, frontend 4, images 2, rest 1) are meant for
production's dyno counts. Staging services have **1 dyno each**, so they must be set to `1`,
otherwise every request is counted several times.

## Sizing

Standard-2X (1 GB). Each Hyperwatch process uses ~185 MB at boot (110 MB of that is the GeoIP
database), so the 4 processes don't fit in a Basic/Standard-1X dyno (it hit R14 at 632 MB within
seconds). History is capped at 1000 entries per node (`.hyperwatchrc`) to keep memory down. Watch
for `R14` in the logs or the Metrics tab.

## Deploying

Always coordinate first: a deploy restarts the dyno.

```sh
git push https://git.heroku.com/oc-staging-watch.git <branch>:main
heroku ps -a oc-staging-watch        # worker.1 up, no web dyno
heroku logs --tail -a oc-staging-watch
```

After a deploy, check: the 4 `http://localhost:33xx` lines, `cloudflared` "Registered tunnel
connection", no `R14`. Roll back with `heroku rollback -a oc-staging-watch`.

## What's not there yet

- **Firewall and fingerprint modules**: not in the published Hyperwatch (npm 5.0.0), only in
  unmerged branches.
- **Persistence**: counters and history reset on every restart (at least daily). A possible next
  step is copying `.hyperwatch-data` to S3 on shutdown and restoring it at boot, in `start.js`.
- **Dashboard**: each instance can serve `@hyperwatch/dashboard` at `/dashboard` (see the
  README). Not deployed yet: it needs the package published, `@hyperwatch/dashboard` added to
  `package.json`, and `WATCH_INSTANCE_URL=https://watch-staging-{service}.opencollective.com` so
  the dashboard links the four instances.
- **Production**: would need its own app, tunnel and hostnames, and the default connection counts.

## How it was set up

1. **Heroku**: `heroku apps:create oc-staging-watch --team opencollective --region us --stack heroku-26`,
   `heroku buildpacks:set heroku/nodejs`, config vars as above.
2. **Cloudflare Access first** (so the hostnames never exist unprotected): a reusable policy
   "Watch engineers" (allow, list of emails), then a self-hosted Access application
   `oc-staging-watch` covering the 4 hostnames, session 24h, with that policy.
3. **Tunnel**: Zero Trust → Networks → Tunnels & Mesh → create `oc-staging-watch` (cloudflared,
   managed from the dashboard), public hostnames `watch-staging-<service>.opencollective.com` →
   `http://localhost:<port>`, catch-all 404. This creates proxied `CNAME` records to
   `<tunnel id>.cfargotunnel.com`. Set its token as `CLOUDFLARE_TUNNEL_TOKEN`.
4. **Deploy**, then `heroku ps:scale web=0`, `heroku ps:type worker=standard-2x`,
   `heroku ps:scale worker=1`.

To rotate the tunnel token: tunnel → Refresh token in Zero Trust, then set the new value on Heroku
(restarts the dyno).
