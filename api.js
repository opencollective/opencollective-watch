// const fs = require('fs');
// const path = require('path');

const hyperwatch = require('@hyperwatch/hyperwatch');
const uuid = require('uuid');

const { basicAuth } = require('./basic-auth');
const { setClientWorkerIdentity } = require('./cloudflare-worker');
const { mountDashboard } = require('./dashboard');
const { attributeFirewallEdits } = require('./firewall-edits');
const {
  hasGraphql,
  registerApplicationNodes,
  registerGraphqlNodes,
} = require('./graphql');
const { hyperwatchOptions } = require('./options');
const {
  setApplicationAndIdentity,
  setGraphqlHash,
  transformInput,
  verifyServiceSecret,
} = require('./transforms');

const { pipeline, input, lib } = hyperwatch;

// Each websocket gets the logs of the one server dyno the router picked. A
// dyno keeps one websocket per clientId and cuts the others, which reconnect
// until they reach a dyno not yet followed: open one per dyno (1 for
// single-dyno services such as staging)
const serverCount = Number(process.env.API_HYPERWATCH_CONNECTIONS) || 2;

// Init Hyperwatch (will load modules)

hyperwatch.init(hyperwatchOptions('api'));

mountDashboard();
basicAuth();
attributeFirewallEdits();

// Connect Inputs (1 per live server)

const clientId = uuid.v4();

for (let i = 1; i <= serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: `WebSocket client #${i} (JSON standard format)`,
    type: 'client',
    address: `${process.env.API_HYPERWATCH_URL}?clientId=${clientId}`,
    reconnectOnClose: true,
    heartbeatInterval: 10000,
    username: process.env.API_HYPERWATCH_USERNAME,
    password: process.env.API_HYPERWATCH_SECRET,
  });

  // oc-secret is checked and removed before any node keeps the logs
  pipeline.registerInput(
    transformInput(websocketClientInput, verifyServiceSecret),
  );
}

// Setup Pipeline and data augmentation

pipeline
  .getNode('main')
  .map(setApplicationAndIdentity, 'set application & identity')
  .map(setClientWorkerIdentity, 'set client worker identity')
  // Before registering main, so every node derived from it has the hash
  .map(setGraphqlHash, 'compute graphql hash')
  .registerNode('main');

registerApplicationNodes(pipeline.getNode('main'));
registerGraphqlNodes(
  pipeline.getNode('main').filter(hasGraphql, 'has graphql'),
);

// Write GraphQL queries to disk

// const graphqlQueriesDir = path.join(__dirname, 'graphql-queries');
// if (!fs.existsSync(graphqlQueriesDir)) {
//   fs.mkdirSync(graphqlQueriesDir, { recursive: true });
// }
//
// pipeline.getNode('graphql').map((log) => {
//   const hash = log.getIn(['graphql', 'hash']);
//   const operationName = log.getIn(['graphql', 'operationName']);
//
//   const filename = [operationName, hash].filter((el) => !!el).join('-');
//   const filepath = path.join(graphqlQueriesDir, `${filename}.graphql`);
//
//   fs.writeFileSync(filepath, log.getIn(['graphql', 'query']));
// }, 'write queries to disk');

// Log GraphQL queries to the console

pipeline.getNode('graphql').map((log) => {
  console.log(lib.logger.defaultFormatter.format(log, 'console'));
}, 'console output');
