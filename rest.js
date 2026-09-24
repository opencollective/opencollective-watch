const hyperwatch = require('@hyperwatch/hyperwatch');

const { setClientWorkerIdentity } = require('./cloudflare-worker');

const { pipeline, input, lib } = hyperwatch;

// Init Hyperwatch (will load modules)

hyperwatch.init({
  persistence: {
    enabled: true,
    namespace: 'rest',
  },
});

// Connect Input

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.REST_HYPERWATCH_URL,
  reconnectOnClose: true,
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
