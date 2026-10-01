# Running Watch on Heroku

Watch runs on Heroku as **`oc-staging-watch`**, plugged into the **staging** servers, and as
**`oc-prod-watch`**, plugged into the production ones. Neither is public: the only way in is a
Cloudflare Tunnel protected by Cloudflare Access (Zero Trust), the same pattern as our Metabase
(`oc-metabase`).

This page describes staging. Production is set up the same way, with its own tunnel and Access
application (`oc-prod-watch`), at `https://watch.opencollective.com`; the differences are noted
where they matter.

## How it works

```
staging servers (api, frontend, images, rest)
        │  wss://…/_hyperwatch/logs/raw (basic auth)
        ▼
oc-staging-watch — one worker dyno, no web process
  bin/start-heroku
   ├─ node start.js -v            the merged Hyperwatch pipeline (all.js) on localhost:3399
   └─ cloudflared tunnel run      outbound connection to Cloudflare
        │
        ▼
Cloudflare Tunnel "oc-staging-watch" ── Cloudflare Access (Google login, allow-list)
        │
        ▼
https://watch-staging.opencollective.com
```

- **No `web` process**, so Heroku never exposes Watch on `*.herokuapp.com`. The Node buildpack
  adds a default `web: npm start` process type: it must stay scaled to **0**.
- `bin/start-heroku` runs Watch and `cloudflared` side by side. If either exits, it stops the other
  and exits non-zero so Heroku restarts the dyno. `start.js` also stops everything if a
  Hyperwatch process dies.
- `cloudflared` is downloaded at build time by `bin/install-cloudflared` (`heroku-postbuild`).
  Set `CLOUDFLARED_VERSION` to pin a release (latest by default).
- One tunnel publishes `watch-staging.opencollective.com` to `localhost:3399`. Anything else gets a 404. The
  per-service processes (`npm start -- api …`, ports 3360, 3300, 3301, 3303) aren't started on
  Heroku.

## Accessing it

Open `https://watch-staging.opencollective.com` (the dashboard is at `/dashboard`) and sign in with Google. Sessions last 24h. Access is an allow-list: ask an admin to add your email
to the **"Watch engineers"** Access policy (Cloudflare Zero Trust → Access controls → Policies).

Useful pages:

| Page                                                   | What                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `/status`                                              | pipeline status, inputs connected                                                               |
| `/logs/<node>`                                         | live stream, one line per request (`main`, `api`, `frontend`, `slow`, `graphql`, …)             |
| `/history/<node>.json?limit=50`                        | last requests (up to 1000 on `main`, 100 elsewhere); filters `address`, `identity`, `signature` |
| `/addresses`, `/identities`, `/signatures`, `/graphql` | aggregated views; add `.csv` or `.json`                                                         |

## Logs

- `heroku logs --tail -a oc-staging-watch`: Watch's own logs, plus `cloudflared`. That's the output
  of the Hyperwatch process (`start.js -v`), prefixed with `[all]`: inputs connecting, persistence
  summaries, warnings and errors. The merged pipeline prints no per-request lines; use
  `/logs/<node>` above for those. Heroku keeps ~1500 lines, there is no log add-on.
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
| `FRONTEND_/IMAGES_/REST_OC_SECRET`             | the `OC_SECRET` of the matching staging app, to verify its calls to the API                                                                                                                                   |
| `WATCH_SECRET`                                 | **not set** on staging, set on production: Basic Auth password, on top of Cloudflare Access (username `WATCH_USERNAME`, default `opencollective`)                                                             |
| `HYPERWATCH_PERSISTENCE`                       | `true`, with the four variables below: counters and history are kept in S3 (see _Persistence_)                                                                                                                |
| `HYPERWATCH_PERSISTENCE_BACKEND`               | `s3`                                                                                                                                                                                                          |
| `HYPERWATCH_PERSISTENCE_S3_BUCKET`             | `opencollective-staging-watch`                                                                                                                                                                                |
| `HYPERWATCH_PERSISTENCE_S3_REGION`             | `us-east-1`, the bucket's region, the same as the app's                                                                                                                                                       |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`   | access key of the IAM user `watch-staging`, read by the AWS SDK                                                                                                                                               |

`<SERVICE>` is `API`, `FRONTEND`, `IMAGES` or `REST`.

Copy a secret without printing it:

```sh
heroku config:set -a oc-staging-watch \
  API_HYPERWATCH_SECRET="$(heroku config:get HYPERWATCH_SECRET -a opencollective-staging-api)" > /dev/null
```

Production has no `*_HYPERWATCH_CONNECTIONS` (the defaults fit its dyno counts) and, for now, no
`HYPERWATCH_PERSISTENCE*` variables: only its `AWS_*` access key (IAM user `watch-production`) is
set.

### Connections per service

Each websocket gets the logs of the one server dyno Heroku's router picked. Watch's websockets to
one service share a `clientId`, and a dyno keeps only one websocket per `clientId`: it cuts the
others, which reconnect until they reach a dyno not yet followed. So Watch needs one websocket per
dyno. The defaults (api 2, frontend 4, images 2, rest 1) are meant for production's dyno counts.
Staging services have **1 dyno each**, so they must be set to `1`, otherwise the extra websockets
keep being cut and reconnecting.

## Persistence

The dyno's disk is wiped on every restart and deploy, so counters and history are kept in S3
(Hyperwatch's `s3` persistence backend, configured in `options.js` from the variables above):

- **Where:** one JSON object per aggregator and per node history, at `all/<name>.json` in the
  bucket. One bucket and one IAM user per environment: `opencollective-staging-watch` /
  `watch-staging`, `opencollective-production-watch` / `watch-production`, in `us-east-1`. Each user
  can only read and write its own bucket.
- **When:** restored at start, before the inputs connect, and saved at shutdown: Heroku's `SIGTERM`
  reaches the Hyperwatch process through `bin/start-heroku` and `start.js`. The final snapshot has
  20 seconds (Hyperwatch's `persistence.deadlines.stop`), within the 30 seconds Heroku gives.
- **No periodic snapshots:** only a clean stop saves. A crash, or a dyno killed for memory, loses
  what was counted since the last start.
- **Checking:** the logs have one `Persistence (s3) loaded …` line at start and one `dumped` line
  at shutdown, with documents, sizes and times; `/status` shows the latest ones. Failures show as
  `Persistence: skipping …` or `Error dumping aggregators` lines.

## Sizing

Staging runs on a Basic dyno (512 MB), production on Standard-2X (1 GB). A Hyperwatch process uses
~120–185 MB at boot (110 MB of that is the GeoIP database). The four per-service processes didn't
fit in a Basic/Standard-1X dyno (R14 at 632 MB within seconds); the merged pipeline is a single
process, which loads the GeoIP database once. On production traffic it used ~235 MB after 3
minutes, still growing as its counters fill: check a day of the Metrics tab before choosing a
smaller dyno. History is capped at 1000 entries on `main` and 100 on the other nodes, with none on
`raw` and the inputs (`.hyperwatchrc`), to keep memory down. Watch for `R14` in the logs or the
Metrics tab.

## Deploying

Always coordinate first: a deploy restarts the dyno.

```sh
git push https://git.heroku.com/oc-staging-watch.git <branch>:main
heroku ps -a oc-staging-watch        # worker.1 up, no web dyno
heroku logs --tail -a oc-staging-watch
```

After a deploy, check: the `all http://localhost:3399` line, `cloudflared` "Registered tunnel
connection", no `R14`. Roll back with `heroku rollback -a oc-staging-watch`.

## What's not there yet

- **Firewall and fingerprint modules**: not in the published Hyperwatch (5.2.0), only in unmerged
  branches.
- **Persistence on production**: its bucket and access key exist, the `HYPERWATCH_PERSISTENCE*`
  variables aren't set yet.
- **Periodic snapshots**: see _Persistence_.

## Moving from one process per service to the merged pipeline

Until [the merged pipeline](../README.md#watching-all-services) became the default, the dyno ran
the four per-service processes, published as `watch-staging-{api,frontend,images,rest}`. Those
hostnames are deprecated: the merged pipeline is published as `watch-staging.opencollective.com`.
In this order, so the new hostname never exists unprotected and the old ones never point at
nothing for long:

1. Access application `oc-staging-watch`: add `watch-staging.opencollective.com`.
2. Tunnel `oc-staging-watch`: public hostname `watch-staging.opencollective.com` →
   `http://localhost:3399`, before the catch-all 404 (creates the proxied `CNAME`). Until the
   deploy, it answers 502.
3. Deploy (see _Deploying_). Check the new hostname: unauthenticated `302` to Cloudflare Access,
   then the pages and `/dashboard` once signed in.
4. Remove the four old hostnames: their tunnel public hostnames, their `CNAME` records, and their
   entries in the Access application. They answer 502 in the meantime (nothing listens on
   3360, 3300, 3301, 3303).

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
