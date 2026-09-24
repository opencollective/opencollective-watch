// const fs = require('fs');
// const path = require('path');

const hyperwatch = require('@hyperwatch/hyperwatch');
const { pick } = require('lodash');
const uuid = require('uuid');

const { setClientWorkerIdentity } = require('./cloudflare-worker');

const { app, pipeline, input, lib, util } = hyperwatch;

const serverCount = 2;

// Init Hyperwatch (will load modules)

hyperwatch.init({
  persistence: {
    enabled: true,
    namespace: 'api',
  },
});

// Connect Inputs (1 per live server)

const clientId = uuid.v4();

for (let i = 1; i <= serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: `WebSocket client #${i} (JSON standard format)`,
    type: 'client',
    address: `${process.env.API_HYPERWATCH_URL}?clientId=${clientId}`,
    reconnectOnClose: true,
    username: process.env.API_HYPERWATCH_USERNAME,
    password: process.env.API_HYPERWATCH_SECRET,
  });

  pipeline.registerInput(websocketClientInput);
}

// Setup Pipeline and data augmentation

pipeline
  .getNode('main')
  .map((log) => {
    const application = log.getIn(['request', 'headers', 'oc-application']);
    if (['frontend', 'images', 'rest'].includes(application)) {
      log = log.set('application', application);
      // Browsers also send oc-application (client-side GraphQL calls), only
      // server-side calls send oc-secret. Its value is random per process, so
      // we can only check it's there.
      if (log.getIn(['request', 'headers', 'oc-secret'])) {
        log = log.set('identity', application);
      }
    }
    if (log.hasIn(['opencollective', 'collective', 'slug'])) {
      log = log.set(
        'identity',
        `@${log.getIn(['opencollective', 'collective', 'slug'])}`,
      );
    }
    return log;
  }, 'set application & identity')
  .map(setClientWorkerIdentity, 'set client worker identity')
  .registerNode('main')
  .filter((log) => log.has('graphql'), 'has graphql')
  .map((log) => {
    log = log.setIn(
      ['graphql', 'hash'],
      util.md5(log.getIn(['graphql', 'query'])).slice(0, 8),
    );
    return log;
  }, 'compute graphql hash')
  .registerNode('graphql');

// Register application nodes

let node, other;
for (const application of ['frontend', 'images', 'rest']) {
  [node, other] = (other || pipeline.getNode('main')).split(
    (log) =>
      log.getIn(['request', 'headers', 'oc-application']) === application,
  );
  node.registerNode(application);
}
other.registerNode('other');

// GraphQL formatter

const formatRequest = (log) => {
  if (!log.has('graphql')) {
    return lib.formatter.request(log);
  }

  const pickList = [
    'id',
    'slug',
    'accountSlug',
    'collectiveSlug',
    'CollectiveSlug',
    'CollectiveId',
    'legacyExpenseId',
    'tierId',
    'term',
    'type',
    'role',
    'tierSlug',
    'TierId',
    'limit',
    'offset',
    'action',
    'reference',
  ];

  const hash = log.getIn(['graphql', 'hash']);
  const operationName = log.getIn(['graphql', 'operationName'], 'unknown');
  const variables = log.getIn(['graphql', 'variables'], {});

  return `${hash} ${operationName} ${JSON.stringify(
    pick(variables.toJS ? variables.toJS() : variables, pickList),
  )} ${log.hasIn(['graphql', 'servedFromCache']) ? 'HIT' : 'MISS'}`;
};

lib.logger.defaultFormatter.replaceFormat('request', formatRequest);

// Add GraphQL aggregator

const { Aggregator } = lib.aggregator;

const aggregator = new Aggregator();

aggregator.setIdentifier(
  (log) => `${log.getIn(['graphql', 'operationName']) || 'unknown'}`,
);

aggregator.setEnricher((entry, log) => {
  if (log.has('graphql')) {
    entry = entry.set('graphql', log.get('graphql'));
  }
  if (log.has('application')) {
    entry = entry.set('application', log.get('application'));
  }
  return entry;
});

const graphqlOperationFormatter = new lib.formatter.Formatter();

graphqlOperationFormatter.setFormats([
  [
    'operation',
    (entry) => entry.getIn(['graphql', 'operationName']) || 'unknown',
  ],
  ['application', (entry) => entry.getIn(['application'])],
  ['15m', (entry) => util.aggregateCount(entry, 'per_minute')],
  ['24h', (entry) => util.aggregateCount(entry, 'per_hour')],

  [
    'executionTime15m',
    (entry) => util.formatDuration(util.aggregateSum(entry, 'per_minute')),
  ],
  [
    'executionTime24h',
    (entry) => util.formatDuration(util.aggregateSum(entry, 'per_hour')),
  ],
]);

aggregator.setFormatter(graphqlOperationFormatter);

pipeline
  .getNode('graphql')
  .map((log) => aggregator.processLog(log), 'graphql aggregator');

app.api.registerAggregator('graphql', aggregator);

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

// Register mutation node

const isMutation = (log) => {
  const query = log.getIn(['graphql', 'query']) || '';
  // Skip leading whitespace and comment lines, then look for the `mutation` keyword
  return /^\s*(#[^\n]*\n\s*)*mutation\b/.test(query);
};

pipeline
  .getNode('graphql')
  .filter(isMutation, 'is mutation')
  .registerNode('graphql-mutation');

// Register slow nodes

pipeline
  .getNode('graphql')
  .filter((log) => log.get('executionTime') > 100, 'executionTime > 100ms')
  .registerNode('graphql-slow');

pipeline
  .getNode('graphql')
  .filter((log) => log.get('executionTime') > 1000, 'executionTime > 1000ms')
  .registerNode('graphql-extra-slow');

// Log GraphQL queries to the console

pipeline.getNode('graphql').map((log) => {
  console.log(lib.logger.defaultFormatter.format(log, 'console'));
}, 'console output');
