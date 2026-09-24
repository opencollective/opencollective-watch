const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { mountDashboard } = require('./dashboard');

// Each websocket gets the logs of the one server dyno the router picked, and
// servers don't dedupe by clientId: use 1 for single-dyno services (staging),
// or every request is counted several times
const serverCount = Number(process.env.FRONTEND_HYPERWATCH_CONNECTIONS) || 4;

const { pipeline, input, lib } = hyperwatch;

// Init Hyperwatch (will load modules)

hyperwatch.init({
  modules: {
    cloudflare: { active: false },
  },
  persistence: {
    enabled: process.env.HYPERWATCH_PERSISTENCE === 'true',
    namespace: 'frontend',
  },
});

mountDashboard('frontend');

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
  .map((log) => {
    const realIp = log.getIn(['request', 'headers', 'oc-real-ip']);
    if (realIp) {
      log = log.setIn(['address', 'value'], realIp);
    }
    return log;
  }, 'extract oc-real-ip')
  .map(setClientWorkerIdentity, 'set client worker identity')
  .filter(
    (log) => !log.getIn(['request', 'url']).match(/^\/_/),
    'exclude /_* urls',
  )
  .filter(
    (log) => !log.getIn(['request', 'url']).match(/^\/static/),
    'exclude /static urls',
  )
  .map(
    (log) =>
      log.updateIn(['request', 'url'], (url) =>
        url.startsWith('/signin/') ? '/signin/_authentication_token_' : url,
      ),
    'redact signin tokens',
  )
  .registerNode('main');

// Register slow nodes

pipeline
  .getNode('main')
  .filter((log) => log.get('executionTime') > 300, 'executionTime > 300ms')
  .registerNode('slow');

pipeline
  .getNode('main')
  .filter((log) => log.get('executionTime') > 1000, 'executionTime > 1000ms')
  .registerNode('extra-slow');

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
