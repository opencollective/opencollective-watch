const hyperwatch = require('@hyperwatch/hyperwatch');

const { pipeline, input, lib } = hyperwatch;

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

// Console Output

pipeline
  .getNode('main')
  .map((log) =>
    console.log(lib.logger.defaultFormatter.format(log, 'console')),
  );
