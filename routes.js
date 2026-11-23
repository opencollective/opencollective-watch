// Routes aggregators: one per service with a route table below
// (/routes-api, /routes-rest, /routes-images, /routes-contributors-svg), one entry per
// route as its requests use it, e.g. /v1/:collectiveSlug.json.
//
// The tables are copies of each service's routes, in the same order (the first
// match wins, as in Express): api server/routes.ts, rest src/server/routes.ts, images
// src/server/routes.ts, contributors-svg src/server/routes.js. Update them
// when a service changes its routes; a request no route matches is counted
// under "(no route)", so a missing route shows up there.

const { app, lib, util } = require('@hyperwatch/hyperwatch');
const html = require('@hyperwatch/hyperwatch/src/app/html');
const { pathToRegexp } = require('path-to-regexp');

const NO_ROUTE = '(no route)';

// api: server/routes.ts. GraphQL is one row per endpoint here (/graphql has
// one per query). Its Express 5 path '/graphql{/:version}{/:apiKey}' as a
// regular expression, as the path-to-regexp here is v6
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
  /^\/graphql(?:\/(?<version>v1|v2))?(?:\/(?<apiKey>[^/]+?))?\/?$/i,
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

// A group that can only match a fixed list of words, e.g. (?<format>json|csv):
// its value is kept in the entry (/v1/…, .csv), any other group is replaced by
// its name (:collectiveSlug), so a route has a bounded number of entries
const FIXED_GROUP = /\(\?<(\w+)>([\w-]+(?:\|[\w-]+)*)\)/g;

// Each route as a regular expression with match indices ("d"), and the name of
// each capturing group, in order. Express paths ('/:collectiveSlug/:backerType.svg')
// go through path-to-regexp, case-insensitive and with an optional trailing
// slash, like Express's default routing
function compileRoute(route) {
  if (typeof route === 'string') {
    const keys = [];
    const regexp = pathToRegexp(route, keys, { sensitive: false, end: true });
    return {
      regexp: new RegExp(regexp.source, `${regexp.flags}d`),
      // The unnamed groups of a path, such as (.*) in /static/(.*), are
      // numbered by path-to-regexp: shown as the path shows them
      groups: keys.map((key) =>
        typeof key.name === 'number' ? '*' : key.name,
      ),
      fixed: new Set(),
    };
  }
  const fixed = new Set(
    [...route.source.matchAll(FIXED_GROUP)].map(([, name]) => name),
  );
  return {
    regexp: new RegExp(route.source, `${route.flags.replace('d', '')}d`),
    groups: null,
    fixed,
  };
}

// Groups whose value is a credential or personal data: hidden in the latest
// path (lastPath), which the aggregator keeps and persists
const SENSITIVE_GROUP = /key|token|secret|email|password/i;
const HIDDEN = '[redacted]';

// The route of a request path, e.g. /v1/nest.json → /v1/:collectiveSlug.json
// (lowercased, without the trailing slash), and the path with the values of
// sensitive groups hidden. Null when no route matches
function matchRoute(compiled, path) {
  for (const { regexp, groups, fixed } of compiled) {
    const match = regexp.exec(path);
    if (!match) {
      continue;
    }
    // The groups that matched, last first: { indices: [start, end], name, kept }
    const named = groups
      ? groups.map((name, i) => ({
          indices: match.indices[i + 1],
          name,
          kept: false,
        }))
      : Object.entries(match.indices.groups).map(([name, indices]) => ({
          indices,
          name,
          kept: fixed.has(name),
        }));
    const matched = named
      .filter(({ indices }) => indices)
      .sort((a, b) => b.indices[0] - a.indices[0]);
    let route = path;
    let shown = path;
    for (const { indices, name, kept } of matched) {
      const [start, end] = indices;
      if (!kept) {
        const replacement = name === '*' ? '*' : `:${name}`;
        route = route.slice(0, start) + replacement + route.slice(end);
      }
      if (SENSITIVE_GROUP.test(name)) {
        shown = shown.slice(0, start) + HIDDEN + shown.slice(end);
      }
    }
    // Lowercase but the group names (:collectiveSlug)
    route = route.replace(/(:\w+)|[^:]+/g, (text, name) =>
      name ? name : text.toLowerCase(),
    );
    return {
      route: route.length > 1 ? route.replace(/\/$/, '') : route,
      path: shown,
    };
  }
  return null;
}

const pathOf = (log) => (log.getIn(['request', 'url']) || '').split('?')[0];

function createAggregator(compiled) {
  const { Aggregator } = lib.aggregator;
  const aggregator = new Aggregator();

  aggregator.setIdentifier(
    (log) => matchRoute(compiled, pathOf(log))?.route || NO_ROUTE,
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

// Registers routes-<service> on the node of each service with a route table.
// Named with a dash: persistence only accepts letters, digits, ".", "_" and "-"
function registerRoutesAggregators(pipeline, services) {
  for (const service of services) {
    if (!ROUTES[service]) {
      continue;
    }
    const compiled = ROUTES[service].map(compileRoute);
    const name = `routes-${service}`;
    const aggregator = createAggregator(compiled);
    pipeline
      .getNode(service)
      .map((log) => aggregator.processLog(log), `${name} aggregator`);
    app.api.registerAggregator(name, aggregator, {
      nav: true,
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
