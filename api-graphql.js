const hyperwatch = require('@hyperwatch/hyperwatch');
const dotenv = require('dotenv');
const { pick } = require('lodash');

const { app, pipeline, input, plugins, modules, start, lib, util } = hyperwatch;

const { cloudflare, geoip, hostname, identity, useragent } = plugins;

// Load config

dotenv.config();

// Add Open Collective specific regexes

lib.useragent.addRegex('robot', {
  regex: '(opencollective-images)/(\\d+)\\.(\\d+)',
  family_replacement: 'Open Collective Images', // eslint-disable-line camelcase
});

lib.useragent.addRegex('robot', {
  regex: '(opencollective-frontend)/(\\d+)\\.(\\d+)',
  family_replacement: 'Open Collective Frontend', // eslint-disable-line camelcase
});

lib.useragent.addRegex('robot', {
  regex: '(opencollective-rest)/(\\d+)\\.(\\d+)',
  family_replacement: 'Open Collective Rest', // eslint-disable-line camelcase
});

// Connect Input

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.API_HYPERWATCH_URL,
  reconnectOnClose: true,
  options: {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.API_HYPERWATCH_USERNAME}:${process.env.API_HYPERWATCH_SECRET}`,
      ).toString('base64')}`,
    },
  },
});

pipeline.registerInput(websocketClientInput);

// Setup Pipeline and data augmentation

pipeline
  .map((log) => cloudflare.augment(log))
  .map((log) => hostname.augment(log))
  .map((log) => geoip.augment(log))
  .map((log) => useragent.augment(log))
  .map((log) => identity.augment(log))
  .map((log) => {
    if (log.getIn(['request', 'headers', 'oc-application']) === 'frontend') {
      // check secret
      log = log.set('application', 'frontend');
      log = log.set('identity', 'frontend');
    }
    if (log.getIn(['request', 'headers', 'oc-application']) === 'images') {
      // check secret
      log = log.set('application', 'images');
      log = log.set('identity', 'images');
    }
    if (log.getIn(['request', 'headers', 'oc-application']) === 'rest') {
      // check secret
      log = log.set('application', 'rest');
      log = log.set('identity', 'rest');
    }
    if (log.hasIn(['opencollective', 'user', 'email'])) {
      log = log.set('identity', log.getIn(['opencollective', 'user', 'email']));
    }
    return log;
  })
  .registerNode('main')
  .filter((log) => log.has('graphql'))
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

// Register slow nodes

pipeline
  .getNode('graphql')
  .filter((log) => log.get('executionTime') > 100)
  .registerNode('slow');

pipeline
  .getNode('graphql')
  .filter((log) => log.get('executionTime') > 1000)
  .registerNode('extra-slow');

// GraphQL formatter

const formatRequest = (log) => {
  if (!log.has('graphql')) {
    return lib.formatter.request(log);
  }

  const pickList = [
    'id',
    'slug',
    'collectiveSlug',
    'CollectiveSlug',
    'CollectiveId',
    'legacyExpenseId',
    'tierId',
    'term',
  ];
  const operationName = log.getIn(['graphql', 'operationName'], 'unknown');
  const variables = log.hasIn(['graphql', 'variables'])
    ? log.getIn(['graphql', 'variables']).toJS()
    : {};
  return `${operationName} ${JSON.stringify(pick(variables, pickList))}`;
};

// Log to the console

const graphqlConsoleFormatter = new lib.formatter.Formatter('console');
graphqlConsoleFormatter.setFormat('request', formatRequest);

pipeline
  .getNode('slow')
  .map((log) => console.log(graphqlConsoleFormatter.format(log)));

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

const graphqlOperationFormatter = new lib.formatter.Formatter('html', {
  operation: (entry) => entry.getIn(['graphql', 'operationName']) || 'unknown',
  application: (entry) => entry.getIn(['application']),
  '15m': (entry) => util.aggregateSpeed(entry, 'per_minute'),
  '24h': (entry) => util.aggregateSpeed(entry, 'per_hour'),
});
aggregator.setFormatter(graphqlOperationFormatter);

pipeline.getNode('graphql').map((log) => aggregator.processLog(log));

app.api.registerAggregator('graphql-operations', aggregator);

// Tweak Logs module for GraphQL usage

const graphqlHtmlFormatter = new lib.formatter.Formatter('html');
graphqlHtmlFormatter.setFormat('request', formatRequest);

modules.logs.setFormatter(graphqlHtmlFormatter);

// Start

modules.load();

start();
