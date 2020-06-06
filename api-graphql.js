const hyperwatch = require('@hyperwatch/hyperwatch');
const chalk = require('chalk');
const dotenv = require('dotenv');
const { pick } = require('lodash');

const { app, pipeline, input, plugins, modules, start, lib, util } = hyperwatch;

const { cloudflare, hostname, dnsbl, geoip, useragent, identity } = plugins;

// Load config

dotenv.config();

// Add Open Collective specific regexes

lib.useragent.addRegex('robot', {
  regex: '(opencollective-images)/(\\d+)\\.(\\d+)',
  family_replacement: 'Images', // eslint-disable-line camelcase
});

lib.useragent.addRegex('robot', {
  regex: '(opencollective-frontend)/(\\d+)\\.(\\d+)',
  family_replacement: 'Frontend', // eslint-disable-line camelcase
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
  .map((log) => dnsbl.augment(log))
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

// Log to the console

pipeline.getNode('slow').map((log) => {
  const identity = log.getIn(['identity']);

  console.log(
    chalk.red(log.getIn(['request', 'time']).slice(11)),

    chalk.white(
      identity ||
        log.getIn(['hostname', 'value']) ||
        log.getIn(['address', 'value']),
    ),

    chalk.blue(log.getIn(['graphql', 'operationName'])),
    chalk.grey(JSON.stringify(log.getIn(['graphql', 'variables']).toJS())),

    chalk.blue(log.getIn(['request', 'headers', 'user-agent'])),

    log.get('executionTime') <= 100
      ? chalk.green(`${log.get('executionTime')}ms`)
      : log.get('executionTime') >= 1000
      ? chalk.red(`${log.get('executionTime')}ms`)
      : chalk.yellow(`${log.get('executionTime')}ms`),
  );

  return log;
});

// Add GraphQL aggregator

const aggregator = new lib.aggregator.Aggregator();

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

aggregator.setMapper((entry) => {
  return {
    operation: entry.getIn(['graphql', 'operationName']) || 'unknown',
    application: entry.getIn(['application']),
    '15m': util.aggregateSpeed(entry, 'per_minute'),
    '24h': util.aggregateSpeed(entry, 'per_hour'),
  };
});

pipeline.getNode('graphql').map((log) => aggregator.processLog(log));

app.api.registerAggregator('graphql', aggregator);

// Tweak Logs module

modules.logs.setFormatter((log) => {
  return `${log.getIn(['request', 'time']).slice(11)} ${
    log.getIn(['identity']) ||
    log.getIn(['hostname', 'value']) ||
    log.getIn(['address', 'value']) ||
    log.getIn(['request', 'address'])
  } ${log.getIn(['graphql', 'operationName'])} ${JSON.stringify(
    pick(log.getIn(['graphql', 'variables']).toJS(), [
      'id',
      'slug',
      'collectiveSlug',
      'CollectiveSlug',
      'CollectiveId',
      'legacyExpenseId',
      'tierId',
    ]),
  )} ${log.get('executionTime')}ms`;
});

// Start

modules.load();

start();
