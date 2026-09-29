// All services in one pipeline. Every log is tagged with the service that sent
// it (`source`: api, frontend, images or rest), whoever issued the request, and
// each source gets its own node derived from main, so aggregators (addresses,
// signatures, identities…) count a client across all of them.

const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { mountDashboard } = require('./dashboard');
const { hasGraphql, registerGraphqlNodes } = require('./graphql');
const { hyperwatchOptions } = require('./options');
const { registerSlowNodes } = require('./slow');
const {
  isAsset,
  redactSigninToken,
  setApplicationAndIdentity,
  setGraphqlHash,
  setImagesIdentity,
  setRealIp,
} = require('./transforms');

const { pipeline, input, lib, modules } = hyperwatch;

// Init Hyperwatch (will load modules)

// frontend.js doesn't use the cloudflare module: it's applied per service
// below instead
hyperwatch.init(
  hyperwatchOptions('all', { modules: { cloudflare: { active: false } } }),
);

mountDashboard();

const cloudflare = modules.get('cloudflare');

// connections: default number of websockets, one per production dyno (see
// the service configs)
// prepare: runs as logs arrive, before any node. It sets the client address
// before modules (geoip, hostname, identity…) use it, and redacts sign-in
// tokens before raw and the input nodes keep the logs in their history.
const SOURCES = {
  api: { connections: 2, prepare: cloudflare.augment },
  frontend: {
    connections: 4,
    prepare: (log) => redactSigninToken(setRealIp(log)),
  },
  images: { connections: 2, prepare: cloudflare.augment },
  rest: { connections: 1, prepare: cloudflare.augment },
};

// Connect Inputs (the live servers of every service)

// Transforms each log as it's received, before it enters the pipeline
function transformInput(websocketInput, transform) {
  return {
    ...websocketInput,
    start: (handlers) =>
      websocketInput.start({
        ...handlers,
        success: (log) => handlers.success(transform(log)),
      }),
  };
}

for (const [service, { connections, prepare }] of Object.entries(SOURCES)) {
  const prefix = service.toUpperCase();
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
  .registerNode('main');

// Register source nodes

for (const source of Object.keys(SOURCES)) {
  let node = pipeline
    .getNode('main')
    .filter((log) => log.get('source') === source, `source = ${source}`);
  // Only the api nodes use it, before registering api so they all have it
  if (source === 'api') {
    node = node.map(setGraphqlHash, 'compute graphql hash');
  }
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
