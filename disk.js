// What Watch writes of a log to disk (Hyperwatch's
// modules.history.disk.transform, see all.js). Logs in memory, in the tables
// and in the live streams are unchanged.

const { createDiskCompactor } = require('./graphql');

// Headers our own infrastructure sets to always the same value (Heroku's
// router, Cloudflare, our frontend and its /api proxy): left out when they
// have that value, kept when they don't, so an unexpected one stays visible
const CONSTANT_HEADERS = {
  'x-forwarded-proto': 'https',
  'x-forwarded-port': '443',
  server: 'Heroku',
  'cf-visitor': '{"scheme":"https"}',
  'original-hostname': 'opencollective.com',
  'apollo-require-preflight': 'true',
  'oc-version': 'undefined',
  'oc-env': 'production',
};

// Tracing headers, different on every request and of no use to tell clients
// apart (x-request-start is request.time)
const TRACING_HEADERS = [
  'baggage',
  'sentry-trace',
  'x-request-id',
  'x-request-start',
];

// Credentials, replaced before logs reach the disk (upstream redaction is
// in progress; memory keeps them until then). Values already replaced
// upstream ("[Filtered]", "[verified]"…) are left as they are
const CREDENTIAL_HEADERS = [
  'api-key',
  // Replaced by [verified] / [unverified] on API logs (verifyServiceSecret),
  // as is on other services' logs
  'oc-secret',
  'personal-token',
  'proxy-authorization',
  'stripe-signature',
  'x-api-key',
  'x-signature',
  'x-signature-sha256',
  'x-two-factor-authentication',
];
const CREDENTIAL_PARAMS = [
  'access_token',
  'apiKey',
  'api_key',
  'personalToken',
  'personal_token',
];
const REDACTED = '[redacted]';

// A whole marker, e.g. "[Filtered]": not a value starting with "["
const isRedacted = (value) => /^\[[A-Za-z ]+\]$/.test(value);

// "Bearer abc" → "Bearer [redacted]": the scheme tells clients apart
function redactAuthorization(value) {
  const scheme = /^(\S+)\s+\S/.exec(value);
  return scheme ? `${scheme[1]} ${REDACTED}` : REDACTED;
}

// "a=1; b=2" → "a=[redacted]; b=[redacted]": cookie names are kept
function redactCookie(value) {
  return value
    .split(';')
    .map((cookie) => {
      const name = cookie.split('=')[0].trim();
      return name ? `${name}=${REDACTED}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

// The value of a credential parameter of a query string, matched on its
// decoded name (`api%5Fkey` is api_key for the server)
function redactQuery(query) {
  return query
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      const raw = equals === -1 ? pair : pair.slice(0, equals);
      let name;
      try {
        name = decodeURIComponent(raw.replace(/\+/g, ' '));
      } catch (err) {
        name = raw;
      }
      return CREDENTIAL_PARAMS.includes(name) ? `${raw}=${REDACTED}` : pair;
    })
    .join('&');
}

function redactUrl(url) {
  const start = url.indexOf('?');
  if (start === -1) {
    return url;
  }
  const hash = url.indexOf('#', start);
  const end = hash === -1 ? url.length : hash;
  return `${url.slice(0, start + 1)}${redactQuery(url.slice(start + 1, end))}${url.slice(end)}`;
}

function redactCredentials(log) {
  let redacted = log;
  const url = log.getIn(['request', 'url']);
  if (typeof url === 'string') {
    redacted = redacted.setIn(['request', 'url'], redactUrl(url));
  }
  if (!redacted.hasIn(['request', 'headers'])) {
    return redacted;
  }
  return redacted.updateIn(['request', 'headers'], (headers) =>
    headers.map((value, name) => {
      if (typeof value !== 'string' || isRedacted(value)) {
        return value;
      }
      if (name === 'authorization') {
        return redactAuthorization(value);
      }
      if (name === 'cookie') {
        return redactCookie(value);
      }
      if (name === 'referer') {
        return redactUrl(value);
      }
      return CREDENTIAL_HEADERS.includes(name) ? REDACTED : value;
    }),
  );
}

function trimHeaders(log) {
  if (!log.hasIn(['request', 'headers'])) {
    return log;
  }
  return log.updateIn(['request', 'headers'], (headers) =>
    headers.filter(
      (value, name) =>
        !TRACING_HEADERS.includes(name) && CONSTANT_HEADERS[name] !== value,
    ),
  );
}

// What is written of a log to `dir`, and read back: credentials redacted
// and headers trimmed for good, GraphQL query texts written once each and
// put back on reading (see createDiskCompactor)
function createDiskCodec(dir) {
  const graphql = createDiskCompactor(dir);
  return {
    transform: (log) => graphql.transform(trimHeaders(redactCredentials(log))),
    restore: graphql.restore,
  };
}

module.exports = {
  CONSTANT_HEADERS,
  CREDENTIAL_HEADERS,
  CREDENTIAL_PARAMS,
  TRACING_HEADERS,
  createDiskCodec,
  redactCredentials,
  trimHeaders,
};
