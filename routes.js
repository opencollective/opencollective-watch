// Routes aggregators: one per service with a route table below
// (/routes-api, /routes-rest, /routes-images, /routes-contributors-svg), one
// entry per route, as the service declares it: its log's route.path, which
// Hyperwatch's Express input sets (docs/log.md, "Route"), e.g.
// /v1/collectives/:collectiveSlug/transactions, a regular expression as its
// literal. Grouped under one "routes" link in the top navigation.
//
// Logs without a route (services on a Hyperwatch older than the route, or a
// middleware such as /graphql, which Express gives no route) get it
// recomputed from the tables, copies of each service's routes in the same
// order (the first match wins, as in Express): api server/routes.ts, rest
// src/server/routes.ts, images src/server/routes.ts, contributors-svg
// src/server/routes.js. Update them when a service changes its routes; a
// request no route matches is counted under "(no route)".

const { app, lib, util } = require('@hyperwatch/hyperwatch');
const html = require('@hyperwatch/hyperwatch/src/app/html');
const { pathToRegexp } = require('path-to-regexp');

const NO_ROUTE = '(no route)';

// api: server/routes.ts. GraphQL is one row here (/graphql has one per
// query): its Express 5 path, matched with a regular expression, as the
// path-to-regexp here is v6
const API = [
  '/users/signin',
  '/users/signup',
  '/users/resend-otp',
  '/users/verify-email',
  '/users/update-token',
  '/users/exchange-login-token',
  '/users/refresh-token',
  '/users/two-factor-auth',
  '/oauth/token',
  '/oauth/authorize',
  '/oauth/authenticate',
  '/id/:id',
  '/permalink/:id',
  {
    path: '/graphql{/:version}{/:apiKey}',
    match: /^\/graphql(?:\/(?<version>v1|v2))?(?:\/(?<apiKey>[^/]+?))?\/?$/i,
  },
  '/webhooks/stripe',
  '/webhooks/transferwise',
  '/webhooks/paypal/:hostId',
  '/webhooks/plaid',
  '/connected-accounts/:service/callback',
  '/contact/send-message',
  '/users/exists',
  '/images',
  '/connected-accounts/:service',
  '/connected-accounts/:service/oauthUrl',
  '/connected-accounts/:service/verify',
  '/services/transferwise/pay-batch',
  '/services/email/unsubscribe/:email/:slug/:type/:token',
  '/github-repositories',
  '/legal-documents/:id/download',
  '/files/:uploadedFileId',
  '/docs/search',
  '/ecosystems/repository',
  '/status',
  '/__test_sentry__',
  '/__test_sentry_crash__',
];

// rest: src/server/routes.ts
const REST = [
  '/',
  '/robots.txt',
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\.(?<format>json)\/?$/i,
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\/members\.(?<format>json|csv)\/?$/i,
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\/members\/(?<backerType>all|users|organizations)\.(?<format>json|csv)\/?$/i,
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\/tiers\/(?<tierSlug>[^/]+?)\/(?<backerType>all|users|organizations)\.(?<format>json|csv)\/?$/i,
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\/events\/(?<eventSlug>[^/]+?)\.(?<format>json)\/?$/i,
  /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\/events\/(?<eventSlug>[^/]+?)\/(?<role>attendees|organizers|all)\.(?<format>json|csv)\/?$/i,
  '/v1/collectives/:collectiveSlug/transactions',
  '/v1/collectives/:collectiveSlug/transactions/:idOrUuid',
  /^\/v2\/(?<slug>[^/]+?)\/tier\/(?<tierSlug>[^/]+?)\/orders(?:\/(?<filter>incoming))?(?:\/(?<status>active|cancelled|error|paid|pending))?\/?$/i,
  /^\/v2\/(?<slug>[^/]+?)\/orders(?:\/(?<filter>incoming|outgoing))?(?:\/(?<status>active|cancelled|error|paid|pending))?\/?$/i,
  /^\/v2\/(?<slug>[^/]+?)\/(?<reportType>hostTransactions|transactions)(?:\/(?<type>credit|debit))?(?:\/(?<kind>contribution|expense|added_funds|host_fee|host_fee_share|host_fee_share_debt|platform_tip|platform_tip_debt))?\.(?<format>json|csv|txt)\/?$/i,
  /^\/v2\/(?<slug>[^/]+?)\/contributors\.(?<format>json|csv)\/?$/i,
  /^\/v2\/(?<slug>[^/]+?)\/hosted-collectives\.(?<format>json|csv)\/?$/i,
];

// images: src/server/routes.ts (and /static in src/server/index.ts)
const IMAGES = [
  '/static/(.*)',
  '/',
  '/proxy/images',
  '/robots.txt',
  /^\/(?<collectiveSlug>[^/]+?)(?:\/(?<hash>[^/]+?))?\/(?<image>avatar|logo)(?:\/(?<style>rounded|square))?(?:\/(?<height>[^/]+?))?(?:\/(?<width>[^/]+?))?\.(?<format>png|jpg|svg)\/?$/i,
  /^\/(?<collectiveSlug>[^/]+?)(?:\/(?<hash>[^/]+?))?\/background(?:\/(?<height>[^/]+?))?(?:\/(?<width>[^/]+?))?\.(?<format>png|jpg)\/?$/i,
  '/:collectiveSlug/:backerType.svg',
  '/:collectiveSlug/:backerType/badge.svg',
  '/:collectiveSlug/:backerType/:position/website',
  /^\/(?<collectiveSlug>[^/]+?)\/(?<backerType>[^/]+?)\/(?<position>[^/]+?)\/avatar(?:\.(?<format>png|jpg|svg))?\/?$/i,
  '/:collectiveSlug/tiers/:tierSlug.svg',
  '/:collectiveSlug/tiers/:tierSlug/badge.svg',
  '/:collectiveSlug/tiers/:tierSlug/:position/website',
  /^\/(?<collectiveSlug>[^/]+?)\/tiers\/(?<tierSlug>[^/]+?)\/(?<position>[^/]+?)\/avatar(?:\.(?<format>png|jpg|svg))?\/?$/i,
];

// contributors-svg: src/server/routes.js (and /static in src/server/index.js)
const CONTRIBUTORS_SVG = [
  '/static/(.*)',
  '/',
  '/robots.txt',
  /^\/github\/(?<githubUsername>[^/]+?)\/(?<image>avatar)(?:\/(?<style>rounded|square))?(?:\/(?<height>[^/]+?))?\.(?<format>png)\/?$/i,
  /^\/(?<collectiveSlug>[^/]+?)\/(?<backerType>contributors)\.svg\/?$/i,
];

const ROUTES = {
  api: API,
  rest: REST,
  images: IMAGES,
  'contributors-svg': CONTRIBUTORS_SVG,
};

// The order of the services on the second line of the routes pages
const SERVICES = Object.keys(ROUTES);

// Each route as a regular expression with match indices ("d"), the name of
// each capturing group, in order, and its path as Hyperwatch logs it: a
// string as is, a regular expression as its literal, or the path given with
// { path, match }. Express paths ('/:collectiveSlug/:backerType.svg') go
// through path-to-regexp, case-insensitive and with an optional trailing
// slash, like Express's default routing
function compileRoute(route) {
  if (typeof route === 'string') {
    const keys = [];
    const regexp = pathToRegexp(route, keys, { sensitive: false, end: true });
    return {
      path: route,
      regexp: new RegExp(regexp.source, `${regexp.flags}d`),
      // The unnamed groups of a path, such as (.*) in /static/(.*), are
      // numbered by path-to-regexp
      groups: keys.map((key) =>
        typeof key.name === 'number' ? '*' : key.name,
      ),
    };
  }
  const { path, match } =
    route instanceof RegExp ? { path: String(route), match: route } : route;
  return {
    path,
    regexp: new RegExp(match.source, `${match.flags.replace('d', '')}d`),
    groups: null,
  };
}

// Groups whose value is a credential or personal data: hidden in the latest
// path (lastPath), which the aggregator keeps and persists
const SENSITIVE_GROUP = /key|token|secret|email|password/i;
const HIDDEN = '[redacted]';

// The route of a request path, as the service declares it, e.g.
// /v1/collectives/nest/transactions → /v1/collectives/:collectiveSlug/transactions,
// and the path with the values of sensitive groups hidden. Null when no route
// matches
function matchRoute(compiled, path) {
  for (const { path: route, regexp, groups } of compiled) {
    const match = regexp.exec(path);
    if (!match) {
      continue;
    }
    const named = groups
      ? groups.map((name, i) => [name, match.indices[i + 1]])
      : Object.entries(match.indices.groups);
    // Last first, so the indices of the others still hold
    const hidden = named
      .filter(([name, indices]) => indices && SENSITIVE_GROUP.test(name))
      .map(([, indices]) => indices)
      .sort((a, b) => b[0] - a[0]);
    let shown = path;
    for (const [start, end] of hidden) {
      shown = shown.slice(0, start) + HIDDEN + shown.slice(end);
    }
    return { route, path: shown };
  }
  return null;
}

const pathOf = (log) => (log.getIn(['request', 'url']) || '').split('?')[0];

function createAggregator(compiled) {
  const { Aggregator } = lib.aggregator;
  const aggregator = new Aggregator();

  // The route the service logged, or else recomputed from its table
  aggregator.setIdentifier(
    (log) =>
      log.getIn(['route', 'path']) ||
      matchRoute(compiled, pathOf(log))?.route ||
      NO_ROUTE,
  );

  // The latest request: its path, and who sent it, as on /graphql
  aggregator.setEnricher((entry, log) => {
    const path = pathOf(log);
    entry = entry.set('lastPath', matchRoute(compiled, path)?.path || path);
    for (const field of ['identity', 'agent']) {
      entry = log.has(field)
        ? entry.set(field, log.get(field))
        : entry.delete(field);
    }
    return entry.set('lastIdentity', util.identityKey(log) || '');
  });

  const { formats, colors } = lib.aggregator.defaultFormatter;
  const agentFormat = formats.find(([key]) => key === 'agent');
  const lastAgent = (entry, output) =>
    agentFormat ? agentFormat[1](entry, output) : '';

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

  // In HTML, in grey and on one line, like the start of a GraphQL query
  const lastPath = (entry, output) => {
    const value = entry.get('lastPath') || '';
    if (output !== 'html') {
      return value;
    }
    return util.safeHtml(
      `<span class="grey" style="white-space: nowrap">${util.escapeHtml(value)}</span>`,
    );
  };

  const statusCount = (key) => (entry) =>
    entry.getIn(['speed', key]) ? util.aggregateCount(entry, key) : 0;

  const formatter = new lib.formatter.Formatter();
  formatter.setFormats([
    ['route', (entry) => entry.get('identifier')],
    ['lastPath', lastPath],
    ['lastAgent', lastAgent],
    ['lastIdentity', lastIdentity],
    // Named like the default sorters, so the table headings sort by them
    ['count15m', (entry) => util.aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => util.aggregateCount(entry, 'per_hour')],
    ['2xx15m', statusCount('2xx_per_minute')],
    ['2xx24h', statusCount('2xx_per_hour')],
    ['4xx15m', statusCount('4xx_per_minute')],
    ['4xx24h', statusCount('4xx_per_hour')],
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
  formatter.colors.route = colors.identity;
  formatter.colors.lastIdentity = colors.identity;
  formatter.colors.lastAgent = colors.agent;
  aggregator.setFormatter(formatter);

  return aggregator;
}

// As on /graphql: the key, the latest request, then count, execTime and
// lastSeen. 2xx and 4xx are in the JSON and CSV only, as on the other pages
const COLUMNS = [
  'route',
  'lastPath',
  'lastAgent',
  'lastIdentity',
  'count',
  'execTime',
  'lastSeen',
];

// Registers routes-<service> on the node of each service with a route table,
// in the "routes" navigation group, labelled by service. Named with a dash:
// persistence only accepts letters, digits, ".", "_" and "-"
function registerRoutesAggregators(pipeline, services) {
  for (const service of SERVICES) {
    if (!services.includes(service)) {
      continue;
    }
    const compiled = ROUTES[service].map(compileRoute);
    const name = `routes-${service}`;
    const aggregator = createAggregator(compiled);
    pipeline
      .getNode(service)
      .map((log) => aggregator.processLog(log), `${name} aggregator`);
    app.api.registerAggregator(name, aggregator, {
      nav: { group: 'routes', label: service },
      identityFilter: true,
      columns: COLUMNS,
    });
  }
}

module.exports = {
  ROUTES,
  compileRoute,
  matchRoute,
  registerRoutesAggregators,
};
