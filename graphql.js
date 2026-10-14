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

// The variables shown in the logs
const VARIABLES_SHOWN = [
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

// The operation's name: the one the client sends, or else the one in the
// query, when it holds a single named operation (`query AccountBySlug(…)`)
function getOperationName(graphql) {
  const sent = graphql && graphql.get('operationName');
  if (sent) {
    return sent;
  }
  const query = graphql && graphql.get('query');
  if (typeof query !== 'string') {
    return null;
  }
  // The definitions at the top level: braces outside comments and strings
  const text = query.replace(/#[^\n]*|"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"/g, ' ');
  const names = [];
  let depth = 0;
  const definition =
    /^\s*(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/;
  for (let i = 0; i < text.length; i++) {
    if (depth === 0 && (i === 0 || text[i - 1] === '}')) {
      const match = definition.exec(text.slice(i));
      if (match) {
        names.push(match[2] || null);
      }
    }
    if (text[i] === '{') {
      depth++;
    } else if (text[i] === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return names.length === 1 ? names[0] : null;
}

// The variables of a request that the logs show (VARIABLES_SHOWN), as JSON
function shownVariables(graphql) {
  // Missing, or null when the client sends "variables": null
  const variables = (graphql && graphql.get('variables')) || {};
  return JSON.stringify(
    pick(variables.toJS ? variables.toJS() : variables, VARIABLES_SHOWN),
  );
}

const formatRequest = (log) => {
  if (!log.has('graphql')) {
    return lib.formatter.request(log);
  }

  const hash = log.getIn(['graphql', 'hash']);
  const operationName = getOperationName(log.get('graphql'));

  return [
    hash,
    operationName,
    shownVariables(log.get('graphql')),
    log.hasIn(['graphql', 'servedFromCache']) ? 'HIT' : 'MISS',
  ]
    .filter(Boolean)
    .join(' ');
};

// GraphQL aggregator

// The start of a query on one line, without comments or the values written in
// it (string literals can hold anything a client sends), except slugs: the
// arguments named like the slug variables shown in the logs, e.g.
// `query { account(slug: "babel") { id name …`
const QUERY_START_LENGTH = 60;
const SLUG_ARGUMENTS = VARIABLES_SHOWN.filter((name) => /slug/i.test(name));
const STRING_LITERAL = new RegExp(
  `(\\b(?:${SLUG_ARGUMENTS.join('|')})\\s*:\\s*)?("""[\\s\\S]*?"""|"(?:[^"\\\\]|\\\\.)*")`,
  'g',
);
function queryStart(query) {
  if (typeof query !== 'string') {
    return '';
  }
  const text = query
    .replace(/#[^\n]*/g, ' ')
    .replace(STRING_LITERAL, (literal, slugArgument) =>
      slugArgument ? literal : '"…"',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return shorten(text);
}

// At most QUERY_START_LENGTH characters, then …
const shorten = (text) =>
  text.length > QUERY_START_LENGTH
    ? `${text.slice(0, QUERY_START_LENGTH)}…`
    : text;

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
    // identity is also what the identified / unidentified filter checks
    for (const field of ['identity', 'agent']) {
      entry = log.has(field)
        ? entry.set(field, log.get(field))
        : entry.delete(field);
    }
    return entry.set('lastIdentity', util.identityKey(log) || '');
  });

  // In HTML, it links to its logs, like on /identities: an address (no
  // identity) in grey
  const lastIdentity = (entry, output) => {
    const key = entry.get('lastIdentity') || '';
    if (!key || output !== 'html') {
      return key;
    }
    return util.safeHtml(
      entry.get('identity')
        ? html.logsLink('identity', key)
        : html.logsLink('identity', key, 'grey'),
    );
  };

  // The operation name, sent or read from the query. Anonymous operations: in
  // HTML, the start of their query, in grey and on one line
  const operation = (entry, output) => {
    const name = getOperationName(entry.get('graphql'));
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
    // The latest request's variables, as the logs show them (empty without any)
    [
      'lastVariables',
      (entry, output) => {
        const shown = shownVariables(entry.get('graphql'));
        if (shown === '{}' || output !== 'html') {
          return shown === '{}' ? '' : shown;
        }
        // In HTML, in grey and on one line, cut like the start of a query
        return util.safeHtml(
          `<span class="grey" style="white-space: nowrap">${util.escapeHtml(
            shorten(shown),
          )}</span>`,
        );
      },
    ],
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
    identityFilter: true,
    columns: [
      'hash',
      'operation',
      'lastVariables',
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
