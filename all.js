// All services in one pipeline. Every log is tagged with the service that sent
// it (`source`: api, frontend, images, rest, pdf or contributors-svg), whoever
// issued the request, and each source gets its own node derived from main, so
// aggregators (addresses, signatures, identities…) count a client across all
// of them.

const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const { basicAuth } = require('./basic-auth');
const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { setContributorsSvgIdentity } = require('./contributors-svg');
const { setAppsScriptIdentity } = require('./google-apps-script');
const { mountDashboard } = require('./dashboard');
const { createDiskCodec } = require('./disk');
const {
  hasGraphql,
  registerGraphqlNodes,
  setGraphqlHash,
} = require('./graphql');
const { hyperwatchOptions } = require('./options');
const { registerSlowNodes } = require('./slow');
const {
  isAsset,
  redactSigninToken,
  setApplicationAndIdentity,
  setImagesIdentity,
  setRealIp,
  transformInput,
  verifyServiceSecret,
} = require('./transforms');

const { pipeline, input, lib, modules } = hyperwatch;

// Init Hyperwatch (will load modules)

// frontend.js doesn't use the cloudflare module: it's applied per service
// below instead.
// Logs of main also go to disk, one NDJSON file per hour
// (/history/main/disk.json reads them back, /history/disk.json shows their
// size), without credentials nor the headers our infrastructure sets, and
// GraphQL query texts once each in graphql-queries.ndjson next to them, put
// back when read (see disk.js). Filtered views (/logs/main?identity=…, the
// dashboard panels) start with them, then go on live. Only this process writes them, in its own
// directory (HYPERWATCH_DISK_HISTORY_DIR overrides it). On Heroku the dyno's
// disk is wiped on restart and deploy: the files go with it.
const diskDir =
  process.env.HYPERWATCH_DISK_HISTORY_DIR || '.hyperwatch-data/logs/all';
const diskCodec = createDiskCodec(diskDir);
hyperwatch.init(
  hyperwatchOptions('all', {
    modules: {
      cloudflare: { active: false },
      history: {
        disk: {
          dir: diskDir,
          nodes: { main: true },
          transform: diskCodec.transform,
          restore: diskCodec.restore,
        },
      },
    },
  }),
);

mountDashboard();
basicAuth();

const cloudflare = modules.get('cloudflare');

// connections: default number of websockets, one per production dyno (see
// the service configs)
// prepare: runs as logs arrive, before any node. It sets the client address
// before modules (geoip, hostname, identity…) use it, and redacts sign-in
// tokens before raw and the input nodes keep the logs in their history.
const SOURCES = {
  api: {
    connections: 2,
    // The GraphQL hash before main, so the logs on disk have it too
    prepare: (log) =>
      setGraphqlHash(verifyServiceSecret(cloudflare.augment(log))),
  },
  frontend: {
    connections: 4,
    prepare: (log) => redactSigninToken(setRealIp(log)),
  },
  images: { connections: 2, prepare: cloudflare.augment },
  rest: { connections: 1, prepare: cloudflare.augment },
  pdf: { connections: 1, prepare: cloudflare.augment },
  'contributors-svg': { connections: 1, prepare: cloudflare.augment },
};

// Connect Inputs (the live servers of every service)

for (const [service, { connections, prepare }] of Object.entries(SOURCES)) {
  // contributors-svg → CONTRIBUTORS_SVG_HYPERWATCH_URL…
  const prefix = service.toUpperCase().replace(/-/g, '_');
  const url = process.env[`${prefix}_HYPERWATCH_URL`];
  if (!url) {
    console.warn(`${prefix}_HYPERWATCH_URL is not set, skipping ${service}`);
    continue;
  }
  const count =
    Number(process.env[`${prefix}_HYPERWATCH_CONNECTIONS`]) || connections;
  const clientId = uuid.v4();

  for (let i = 1; i <= count; i++) {
    const websocketClientInput = input.websocket.create({
      name: `${service} WebSocket client #${i} (JSON standard format)`,
      type: 'client',
      address: `${url}?clientId=${clientId}`,
      reconnectOnClose: true,
      heartbeatInterval: 10000,
      username: process.env[`${prefix}_HYPERWATCH_USERNAME`],
      password: process.env[`${prefix}_HYPERWATCH_SECRET`],
    });

    pipeline.registerInput(
      transformInput(websocketClientInput, (log) =>
        prepare(log.set('source', service)),
      ),
    );
  }
}

// Setup Pipeline and data augmentation, as in the service configs

const forSource = (source, f) => (log) =>
  log.get('source') === source ? f(log) : log;

pipeline
  .getNode('main')
  .filter(
    (log) => log.get('source') !== 'frontend' || !isAsset(log),
    'exclude frontend /_* and /static urls',
  )
  .map(
    forSource('api', setApplicationAndIdentity),
    'api: set application & identity',
  )
  .map(forSource('images', setImagesIdentity), 'images: set images identity')
  .map(setClientWorkerIdentity, 'set client worker identity')
  .map(setAppsScriptIdentity, 'set apps script identity')
  .map(setContributorsSvgIdentity, 'set contributors-svg self-calls identity')
  .registerNode('main');

// Register source nodes

for (const source of Object.keys(SOURCES)) {
  const node = pipeline
    .getNode('main')
    .filter((log) => log.get('source') === source, `source = ${source}`);
  node.registerNode(source);
}

// api: split into graphql (with graphql-mutation, graphql-slow…) and other.
// Calls from our own services are told apart by identity (Open Collective
// Frontend…)

const [graphql, other] = pipeline
  .getNode('api')
  .split(hasGraphql, ['has graphql', 'no graphql']);

registerGraphqlNodes(graphql);
other.registerNode('other');

// frontend: slow nodes, as in frontend.js

registerSlowNodes(pipeline.getNode('frontend'));

// Source column, in /logs and the console

lib.logger.defaultFormatter.insertFormat('source', (log) => log.get('source'), {
  before: 'request',
  color: 'grey',
});
