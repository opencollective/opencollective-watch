const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const serverCount = 2;

const { pipeline, input, lib } = hyperwatch;

// Init Hyperwatch (will load modules)

hyperwatch.init({});

// Connect Inputs (1 per live server)

const clientId = uuid.v4();

for (let i = 1; i <= serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: `WebSocket client #${i} (JSON standard format)`,
    type: 'client',
    address: `${process.env.FRONTEND_HYPERWATCH_URL}?clientId=${clientId}`,
    reconnectOnClose: true,
    username: process.env.FRONTEND_HYPERWATCH_USERNAME,
    password: process.env.FRONTEND_HYPERWATCH_SECRET,
  });

  pipeline.registerInput(websocketClientInput);
}

pipeline
  .getNode('main')
  .filter((log) => !log.getIn(['request', 'url']).match(/^\/_/))
  .filter((log) => !log.getIn(['request', 'url']).match(/^\/static/))
  .map((log) =>
    log.updateIn(['request', 'url'], (url) =>
      url.startsWith('/signin/') ? '/signin/_authentication_token_' : url,
    ),
  )
  .registerNode('main');

// Register slow nodes

pipeline
  .getNode('main')
  .filter((log) => log.get('executionTime') > 300)
  .registerNode('slow');

pipeline
  .getNode('main')
  .filter((log) => log.get('executionTime') > 1500)
  .registerNode('extra-slow');

pipeline
  .getNode('extra-slow')
  .map((log) =>
    console.log(lib.logger.defaultFormatter.format(log, 'console')),
  );
