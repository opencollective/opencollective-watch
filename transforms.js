const crypto = require('crypto');

const { util } = require('@hyperwatch/hyperwatch');

// Per-service log transforms, shared by the service configs (api.js,
// frontend.js, images.js…) and the merged one (all.js)

// Identities of our own servers, whichever service logs their requests
const SERVICE_IDENTITIES = {
  frontend: 'Open Collective Frontend',
  images: 'Open Collective Images',
  rest: 'Open Collective REST',
  pdf: 'Open Collective PDF',
};

// The environment variable holding the oc-secret each of our servers sends
// when it calls the API. No entry for the API itself: it's the one being
// called, and never sends oc-secret (it only reads oc-application, to name
// GraphQL clients), so there's no API_OC_SECRET to verify.
const SERVICE_SECRETS = {
  frontend: 'FRONTEND_OC_SECRET',
  images: 'IMAGES_OC_SECRET',
  rest: 'REST_OC_SECRET',
  pdf: 'PDF_OC_SECRET',
};

// The frontend also runs on Vercel, with its own OC_SECRET
// (VERCEL_FRONTEND_OC_SECRET) and its own identity
const VERCEL_FRONTEND_IDENTITY = 'Vercel Frontend';

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function matchesSecret(secret, variable) {
  const expected = variable ? process.env[variable] : undefined;
  return (
    Boolean(expected) &&
    typeof secret === 'string' &&
    safeEqual(secret, expected)
  );
}

// api: check the oc-secret of a call against the one its server is configured
// with (<SERVICE>_OC_SECRET), then replace it with [verified] or [unverified]:
// logs are kept in history and shown, the secret must not be. Runs as logs
// arrive, before any node keeps them.
function verifyServiceSecret(log) {
  const secret = log.getIn(['request', 'headers', 'oc-secret']);
  if (secret === undefined) {
    return log;
  }
  const application = log.getIn(['request', 'headers', 'oc-application']);
  const vercel =
    application === 'frontend' &&
    matchesSecret(secret, 'VERCEL_FRONTEND_OC_SECRET');
  const verified =
    vercel || matchesSecret(secret, SERVICE_SECRETS[application]);
  log = log.setIn(
    ['request', 'headers', 'oc-secret'],
    verified ? '[verified]' : '[unverified]',
  );
  if (vercel) {
    log = log.set('verifiedDeployment', 'vercel');
  }
  return verified ? log.set('verifiedApplication', application) : log;
}

// api: identify collectives (signed-in users…), and tag calls from our own
// services
function setApplicationAndIdentity(log) {
  if (log.hasIn(['opencollective', 'collective', 'slug'])) {
    log = log.set(
      'identity',
      `@${log.getIn(['opencollective', 'collective', 'slug'])}`,
    );
  }
  const application = log.getIn(['request', 'headers', 'oc-application']);
  if (SERVICE_IDENTITIES[application]) {
    log = log.set('application', application);
    // Browsers also send oc-application (client-side GraphQL calls): only
    // calls with a verified oc-secret (verifyServiceSecret) are our servers.
    // Our server prevails over the user it calls on behalf of.
    if (log.get('verifiedApplication') === application) {
      log = log.set(
        'identity',
        log.get('verifiedDeployment') === 'vercel'
          ? VERCEL_FRONTEND_IDENTITY
          : SERVICE_IDENTITIES[application],
      );
    }
  }
  return log;
}

// api
function setGraphqlHash(log) {
  return log.hasIn(['graphql', 'query'])
    ? log.setIn(
        ['graphql', 'hash'],
        util.md5(log.getIn(['graphql', 'query'])).slice(0, 8),
      )
    : log;
}

// frontend: the client address, as seen by our Cloudflare Worker
function setRealIp(log) {
  const realIp = log.getIn(['request', 'headers', 'oc-real-ip']);
  return realIp ? log.setIn(['address', 'value'], realIp) : log;
}

// frontend: Next.js internals (/_next, …) and static files
function isAsset(log) {
  return /^\/(_|static)/.test(log.getIn(['request', 'url']));
}

// frontend
function redactSigninToken(log) {
  return log.updateIn(['request', 'url'], (url) =>
    url.startsWith('/signin/') ? '/signin/_authentication_token_' : url,
  );
}

// images: the images server fetching its own images, e.g. avatars for
// banners. Identified by user agent only: these fetches never send oc-secret,
// as their URLs are user-controlled.
function setImagesIdentity(log) {
  return log.getIn(['agent', 'family']) === 'opencollective-images'
    ? log.set('identity', SERVICE_IDENTITIES.images)
    : log;
}

// An input whose logs go through `transform` as they're received, before
// the pipeline and its nodes (raw, input-N), which keep them in their history
function transformInput(websocketInput, transform) {
  return {
    ...websocketInput,
    start: (handlers) =>
      websocketInput.start({
        ...handlers,
        success: (log) => handlers.success(transform(log)),
      }),
  };
}

module.exports = {
  isAsset,
  redactSigninToken,
  setApplicationAndIdentity,
  setGraphqlHash,
  setImagesIdentity,
  setRealIp,
  transformInput,
  verifyServiceSecret,
};
