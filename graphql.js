const { app, lib, util } = require('@hyperwatch/hyperwatch');
const { pick } = require('lodash');

const { registerSlowNodes } = require('./slow');

// API nodes: the GraphQL ones are shared by the api config (below main) and
// the merged one (below the api node, see all.js)

// Splits API calls by the oc-application header: frontend, images, rest, pdf
// and other, the clients calling the API directly
const APPLICATIONS = ['frontend', 'images', 'rest', 'pdf'];

const getApplication = (log) =>
  log.getIn(['request', 'headers', 'oc-application']);

function registerApplicationNodes(parent) {
  for (const application of APPLICATIONS) {
    parent
      .filter(
        (log) => getApplication(log) === application,
        `oc-application = ${application}`,
      )
      .registerNode(application);
  }
  parent
    .filter(
      (log) => !APPLICATIONS.includes(getApplication(log)),
      'other oc-application',
    )
    .registerNode('other');
}

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
  const operationName = log.getIn(['graphql', 'operationName']);
  // Missing, or null when the client sends "variables": null
  const variables = log.getIn(['graphql', 'variables']) || {};

  return [
    hash,
    operationName,
    JSON.stringify(
      pick(variables.toJS ? variables.toJS() : variables, pickList),
    ),
    log.hasIn(['graphql', 'servedFromCache']) ? 'HIT' : 'MISS',
  ]
    .filter(Boolean)
    .join(' ');
};

// GraphQL aggregator

function createAggregator() {
  const { Aggregator } = lib.aggregator;

  const aggregator = new Aggregator();

  // Anonymous operations are grouped together, with an empty name
  aggregator.setIdentifier(
    (log) => log.getIn(['graphql', 'operationName']) || '',
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
    ['operation', (entry) => entry.getIn(['graphql', 'operationName']) || ''],
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

  return aggregator;
}

const isMutation = (log) => {
  const query = log.getIn(['graphql', 'query']) || '';
  // Skip leading whitespace and comment lines, then look for the `mutation` keyword
  return /^\s*(#[^\n]*\n\s*)*mutation\b/.test(query);
};

const hasGraphql = (log) => log.has('graphql');

// Registers `graphql`, a branch of GraphQL logs (they need their graphql hash
// first, see setGraphqlHash), as the graphql node with its mutation and slow
// nodes, the /graphql aggregator and the GraphQL request format
function registerGraphqlNodes(graphql) {
  lib.logger.defaultFormatter.replaceFormat('request', formatRequest);

  graphql.registerNode('graphql');

  const aggregator = createAggregator();
  graphql.map((log) => aggregator.processLog(log), 'graphql aggregator');
  app.api.registerAggregator('graphql', aggregator);

  graphql.filter(isMutation, 'is mutation').registerNode('graphql-mutation');

  registerSlowNodes(graphql, { prefix: 'graphql-' });
}

module.exports = { hasGraphql, registerApplicationNodes, registerGraphqlNodes };
