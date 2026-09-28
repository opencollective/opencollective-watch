const { util } = require('@hyperwatch/hyperwatch');

// Per-service log transforms, shared by the service configs (api.js,
// frontend.js, images.js) and the merged one (all.js)

// Identities of our own servers, whichever service logs their requests
const SERVICE_IDENTITIES = {
  frontend: 'Open Collective Frontend',
  images: 'Open Collective Images',
  rest: 'Open Collective REST',
};

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
    // Browsers also send oc-application (client-side GraphQL calls), only
    // server-side calls send oc-secret. Its value is random per process, so
    // we can only check it's there. Our server prevails over the user it calls
    // on behalf of.
    if (log.getIn(['request', 'headers', 'oc-secret'])) {
      log = log.set('identity', SERVICE_IDENTITIES[application]);
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

module.exports = {
  isAsset,
  redactSigninToken,
  setApplicationAndIdentity,
  setGraphqlHash,
  setImagesIdentity,
  setRealIp,
};
