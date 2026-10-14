const { app, lib, util } = require('@hyperwatch/hyperwatch');
const html = require('@hyperwatch/hyperwatch/src/app/html');
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
    // Who sent the latest request: its identity, or its address when it has
    // none, as /identities groups them (see lastIdentity below), and its agent
    entry = log.has('agent')
      ? entry.set('agent', log.get('agent'))
      : entry.delete('agent');
    return entry
      .set('lastIdentity', util.identityKey(log) || '')
      .set('lastIdentified', log.has('identity'));
  });

  // In HTML, it links to its logs, like on /identities: an address (no
  // identity) in grey
  const lastIdentity = (entry, output) => {
    const key = entry.get('lastIdentity') || '';
    if (!key || output !== 'html') {
      return key;
    }
    return util.safeHtml(
      entry.get('lastIdentified')
        ? html.logsLink('identity', key)
        : html.logsLink('identity', key, 'grey'),
    );
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

  // The agent of the latest request, formatted as on /identities
  const { formats, colors } = lib.aggregator.defaultFormatter;
  const agentFormat = formats.find(([key]) => key === 'agent');
  const lastAgent = (entry, output) =>
    agentFormat ? agentFormat[1](entry, output) : '';

  const graphqlOperationFormatter = new lib.formatter.Formatter();

  graphqlOperationFormatter.setFormats([
    ['hash', (entry) => entry.getIn(['graphql', 'hash']) || ''],
    ['operation', operation],
    ['lastAgent', lastAgent],
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
  graphqlOperationFormatter.colors.lastAgent = colors.agent;

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
      'lastAgent',
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
