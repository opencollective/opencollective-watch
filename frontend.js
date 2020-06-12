const hyperwatch = require('@hyperwatch/hyperwatch');

const { pipeline, input, lib } = hyperwatch;

const serverCount = 2;

// Connect Inputs (1 per live server)

for (let i = 0; i < serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: 'WebSocket client (JSON standard format)',
    type: 'client',
    address: process.env.FRONTEND_HYPERWATCH_URL,
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
  .registerNode('main');

pipeline
  .getNode('main')
  .map((log) =>
    console.log(lib.logger.defaultFormatter.format(log, 'console')),
  );
