const hyperwatch = require('@hyperwatch/hyperwatch');

const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { mountDashboard } = require('./dashboard');
const { hyperwatchOptions } = require('./options');

const { pipeline, input, lib } = hyperwatch;

// Init Hyperwatch (will load modules)

hyperwatch.init(hyperwatchOptions('rest'));

mountDashboard('rest');

// Connect Input

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.REST_HYPERWATCH_URL,
  reconnectOnClose: true,
  heartbeatInterval: 10000,
  username: process.env.REST_HYPERWATCH_USERNAME,
  password: process.env.REST_HYPERWATCH_SECRET,
});

pipeline.registerInput(websocketClientInput);

pipeline
  .getNode('main')
  .map(setClientWorkerIdentity, 'set client worker identity')
  .registerNode('main');

// Console Output

pipeline
  .getNode('main')
  .map(
    (log) => console.log(lib.logger.defaultFormatter.format(log, 'console')),
    'console output',
  );
