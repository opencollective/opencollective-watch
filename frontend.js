const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { mountDashboard } = require('./dashboard');
const { hyperwatchOptions } = require('./options');
const { registerSlowNodes } = require('./slow');
const { isAsset, redactSigninToken, setRealIp } = require('./transforms');

// Each websocket gets the logs of the one server dyno the router picked. A
// dyno keeps one websocket per clientId and cuts the others, which reconnect
// until they reach a dyno not yet followed: open one per dyno (1 for
// single-dyno services such as staging)
const serverCount = Number(process.env.FRONTEND_HYPERWATCH_CONNECTIONS) || 4;

const { pipeline, input, lib } = hyperwatch;

// Init Hyperwatch (will load modules)

hyperwatch.init(
  hyperwatchOptions('frontend', { modules: { cloudflare: { active: false } } }),
);

mountDashboard();

// Connect Inputs (1 per live server)

const clientId = uuid.v4();

for (let i = 1; i <= serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: `WebSocket client #${i} (JSON standard format)`,
    type: 'client',
    address: `${process.env.FRONTEND_HYPERWATCH_URL}?clientId=${clientId}`,
    reconnectOnClose: true,
    heartbeatInterval: 10000,
    username: process.env.FRONTEND_HYPERWATCH_USERNAME,
    password: process.env.FRONTEND_HYPERWATCH_SECRET,
  });

  pipeline.registerInput(websocketClientInput);
}

pipeline
  .getNode('main')
  .map(setRealIp, 'extract oc-real-ip')
  .map(setClientWorkerIdentity, 'set client worker identity')
  .filter((log) => !isAsset(log), 'exclude /_* and /static urls')
  .map(redactSigninToken, 'redact signin tokens')
  .registerNode('main');

// Register slow nodes

registerSlowNodes(pipeline.getNode('main'));

lib.logger.defaultFormatter.insertFormat(
  'domain',
  (log) => {
    const hostname = log.getIn(['request', 'headers', 'original-hostname']);
    if (hostname && hostname !== 'opencollective.com') {
      return hostname;
    }
  },
  { after: 'address', color: 'grey' },
);

// Split by identity status
const [withIdentity, withoutIdentity] = pipeline
  .getNode('main')
  .split((log) => log.has('identity'), ['has identity', 'no identity']);

withIdentity.registerNode('with-identity');
withoutIdentity.registerNode('without-identity');

// Console output

const consoleNode = 'main';
// Only show traffic without an identity:
// const consoleNode = 'without-identity';

pipeline.getNode(consoleNode).map((log) => {
  console.log(lib.logger.defaultFormatter.format(log, 'console'));
}, 'console output');
