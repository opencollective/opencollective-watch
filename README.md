# Open Collective Watch

## Foreword

If you see a step below that could be improved (or is outdated), please update the instructions. We rarely go through this process ourselves, so your fresh pair of eyes and your recent experience with it, makes you the best candidate to improve them for other users. Thank you!

## Usage

### Setup

Set the servers to follow in `.env`, one block per service:

```
API_HYPERWATCH_URL=wss://{API_DOMAIN}/{HYPERWATCH_PATH}/logs/raw
API_HYPERWATCH_USERNAME={USERNAME}
API_HYPERWATCH_SECRET={SECRET}

FRONTEND_HYPERWATCH_URL=wss://{FRONTEND_DOMAIN}/{HYPERWATCH_PATH}/logs/raw
FRONTEND_HYPERWATCH_USERNAME={USERNAME}
FRONTEND_HYPERWATCH_SECRET={SECRET}

IMAGES_HYPERWATCH_URL=wss://{IMAGES_DOMAIN}/{HYPERWATCH_PATH}/logs/raw
IMAGES_HYPERWATCH_USERNAME={USERNAME}
IMAGES_HYPERWATCH_SECRET={SECRET}

REST_HYPERWATCH_URL=wss://{REST_DOMAIN}/{HYPERWATCH_PATH}/logs/raw
REST_HYPERWATCH_USERNAME={USERNAME}
REST_HYPERWATCH_SECRET={SECRET}
```

A service without `<SERVICE>_HYPERWATCH_URL` is skipped.

### Watching all services

```
npm start                  # quiet, errors in logs/all.log
npm start -- -v            # stream the output
npm start -- --stderr      # stream only errors
```

Watch runs one Hyperwatch pipeline, on http://localhost:3399, that merges the requests of the four
services. `/addresses`, `/signatures` and `/identities` count a client across all of them:

- see pipeline status: http://localhost:3399/status
- browse addresses: http://localhost:3399/addresses
- browse identities: http://localhost:3399/identities
- watch real time logs: http://localhost:3399/logs/main

Each request has a `source` field, the service that logged it (`api`, `frontend`, `images`,
`rest`), whoever issued it: API calls made by our own frontend are in `api` too. Calls from our own
servers have their identity: `Open Collective Frontend`, `Open Collective Images`,
`Open Collective REST`. The nodes are:

- `main`: every request
- `api`, `frontend`, `images`, `rest`: one source each
- below `api`: `graphql` (with `graphql-mutation`, `graphql-slow`, `graphql-extra-slow` and the
  `/graphql` aggregator) and `other`, the API requests that aren't GraphQL
- below `frontend`: `slow` and `extra-slow`

Slow nodes (`slow`, `graphql-slow`…) hold requests over 300 ms, extra-slow ones over 1 s
(`slow.js`).

### One process per service

Each service also has its own config, with its own counters, started when asked for:

```
npm start -- api images    # pick configs, one process each
npm start -- all api       # the merged pipeline and the api one
npm run start:api          # or start:frontend, start:images, start:rest
```

| Config     | Port | Nodes                                                                                    |
| ---------- | ---- | ---------------------------------------------------------------------------------------- |
| `api`      | 3360 | `graphql`… as in `all`, and `frontend` / `images` / `rest` / `other` by `oc-application` |
| `frontend` | 3300 | `slow`, `extra-slow`, `with-identity`, `without-identity`                                |
| `images`   | 3301 | one per image route: `avatar`, `banner`, `badge`, `proxy`…                               |
| `rest`     | 3303 | `main` only                                                                              |

Errors are kept in `logs/<config>.log`. If one process crashes, the others are stopped.

### Options

Optional environment variables:

- `FRONTEND_OC_SECRET`, `IMAGES_OC_SECRET`, `REST_OC_SECRET`: the `OC_SECRET` of each of our
  servers. API calls whose `oc-secret` header matches get that server's identity
  (`Open Collective Frontend`…); others don't. The header's value is replaced with `[verified]`
  or `[unverified]` as logs arrive, so the secrets are never kept or shown.
- `WATCH_SECRET`: puts Basic Auth in front of the whole instance (pages, JSON, CSV, log streams,
  WebSockets), with the username `WATCH_USERNAME` (default `opencollective`). Off when not set.
- `HYPERWATCH_PERSISTENCE=true`: save counters and history to `.hyperwatch-data/` on shutdown and
  reload them at start.
- `HYPERWATCH_HISTORY_CAPACITY`: requests kept per pipeline node for `/history` and the live logs
  (default 1000 in `.hyperwatchrc`, sized for Heroku). Raise it locally, e.g. `10000`, at the cost
  of memory. The merged `main` node gets the traffic of every service, so 1000 requests only cover
  a minute or two.
- `API_HYPERWATCH_CONNECTIONS`, `FRONTEND_HYPERWATCH_CONNECTIONS`, `IMAGES_HYPERWATCH_CONNECTIONS`:
  websockets opened per service, one per server dyno (defaults 2, 4, 2). A dyno keeps one websocket
  from Watch and cuts the others, which keep reconnecting: use `1` against single-dyno servers such
  as staging.

### Dashboard

Each instance serves the [Hyperwatch dashboard](https://github.com/hyperwatch/dashboard)
(`@hyperwatch/dashboard`) at `/dashboard`, e.g. http://localhost:3399/dashboard. Without the package
installed, Watch runs without a dashboard.

To work on the dashboard, clone it next to Hyperwatch and link it:

```
git clone git@github.com:hyperwatch/dashboard.git
cd dashboard && npm install && npm run build && npm link
cd ../watch && npm link @hyperwatch/dashboard
```

Then run `npm run watch` in the dashboard repo: every change is rebuilt and served by the running
instances, reload the page to see it (the instance links keep the current page and its settings).
`npm install` in Watch replaces the link with the published package; link again afterwards.

### Running on Heroku

Watch runs on Heroku for staging, behind Cloudflare Access. See [docs/heroku.md](docs/heroku.md).

### Using a development version of Hyperwatch

Clone and link Hyperwatch:

```
git clone git@github.com:hyperwatch/hyperwatch.git
cd hyperwatch
npm install
npm link
```

Then link in the current project:

```
npm link @hyperwatch/hyperwatch
```

## Contributing

Code style? Commit convention?

TL;DR: we use [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/), we do like great commit messages and clean Git history.

## Discussion

If you have any questions, ping us on [Discord](https://discord.opencollective.com).
