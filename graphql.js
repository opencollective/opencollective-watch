const { app, lib, util } = require('@hyperwatch/hyperwatch');
const { pick } = require('lodash');

const { registerSlowNodes } = require('./slow');

// API nodes: the GraphQL ones are shared by the api config (below main) and
// the merged one (below the api node, see all.js)

// Splits API calls by the oc-application header: frontend, images, rest, pdf,
// contributors-svg and other, the clients calling the API directly
const APPLICATIONS = ['frontend', 'images', 'rest', 'pdf', 'contributors-svg'];

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

// The start of a query on one line, without comments or the values written in
// it (string literals can hold anything a client sends), e.g.
// `query { account(slug: "…") { id name …`
const QUERY_START_LENGTH = 60;
function queryStart(query) {
  if (typeof query !== 'string') {
    return '';
  }
  const text = query
    .replace(/#[^\n]*/g, ' ')
    .replace(/"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > QUERY_START_LENGTH
    ? `${text.slice(0, QUERY_START_LENGTH)}…`
    : text;
}

function createAggregator() {
  const { Aggregator } = lib.aggregator;

  const aggregator = new Aggregator();

  // One entry per query (its hash, see setGraphqlHash): an operation name can
  // be sent with different queries. Logs without a query text are grouped by
  // operation name, anonymous ones together.
  aggregator.setIdentifier(
    (log) =>
      log.getIn(['graphql', 'hash']) ||
      `operation:${log.getIn(['graphql', 'operationName']) || ''}`,
  );

  aggregator.setEnricher((entry, log) => {
    if (log.has('graphql')) {
      entry = entry.set('graphql', log.get('graphql'));
    }
    if (log.has('application')) {
      entry = entry.set('application', log.get('application'));
    }
    // Who sent the latest request (see lastIdentity below)
    for (const field of ['identity', 'agent']) {
      entry = log.has(field)
        ? entry.set(field, log.get(field))
        : entry.delete(field);
    }
    return entry;
  });

  // The identity of the latest request, as on /addresses: in HTML, it falls
  // back to the agent, in grey
  const { formats, colors } = lib.aggregator.defaultFormatter;
  const identityFormat = formats.find(([key]) => key === 'identity');
  const agentFormat = formats.find(([key]) => key === 'agent');
  const lastIdentity = (entry, output) => {
    const value = identityFormat ? identityFormat[1](entry, output) : '';
    if (value || output !== 'html' || !agentFormat) {
      return value;
    }
    const lastAgent = agentFormat[1](entry, output);
    return lastAgent
      ? util.safeHtml(`<span class="grey">${util.toHtml(lastAgent)}</span>`)
      : '';
  };

  // Anonymous operations: in HTML, the start of their query, in grey and on
  // one line
  const operation = (entry, output) => {
    const name = entry.getIn(['graphql', 'operationName']);
    if (name || output !== 'html') {
      return name || '';
    }
    const start = queryStart(entry.getIn(['graphql', 'query']));
    return start
      ? util.safeHtml(
          `<span class="grey" style="white-space: nowrap">${util.toHtml(start)}</span>`,
        )
      : '';
  };

  const graphqlOperationFormatter = new lib.formatter.Formatter();

  graphqlOperationFormatter.setFormats([
    ['hash', (entry) => entry.getIn(['graphql', 'hash']) || ''],
    ['operation', operation],
    ['application', (entry) => entry.getIn(['application'])],
    ['lastIdentity', lastIdentity],
    // Named like the default sorters (count15m, execTime24h…), so the table
    // headings sort by them, as on /identities
    ['count15m', (entry) => util.aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => util.aggregateCount(entry, 'per_hour')],
    [
      'execTime15m',
      (entry) => util.formatDuration(util.aggregateSum(entry, 'per_minute')),
    ],
    [
      'execTime24h',
      (entry) => util.formatDuration(util.aggregateSum(entry, 'per_hour')),
    ],
    ['lastSeen', lib.aggregator.lastSeen],
  ]);

  graphqlOperationFormatter.colors.lastIdentity = colors.identity;

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
  app.api.registerAggregator('graphql', aggregator, {
    nav: true,
    columns: [
      'hash',
      'operation',
      'application',
      'lastIdentity',
      'count',
      'execTime',
      'lastSeen',
    ],
  });

  graphql.filter(isMutation, 'is mutation').registerNode('graphql-mutation');

  registerSlowNodes(graphql, { prefix: 'graphql-' });
}

module.exports = { hasGraphql, registerApplicationNodes, registerGraphqlNodes };
