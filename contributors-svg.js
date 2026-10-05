// contributors-svg fetches its own routes (the avatars and the contribute
// button of its banners) without oc-secret: only its API calls carry it.
// Those requests come from the same dyno, so from the address of its verified
// API calls: Watch remembers those addresses (until it restarts, a dyno
// restart brings a new one) and identifies the requests contributors-svg
// logs from them with its own user agent.
//
// Weaker than the secret: on Heroku's Common Runtime, other apps' dynos can
// share the host's outbound address.

const IDENTITY = 'Contributors SVG';
const USER_AGENT = 'contributors-svg/1.0';

const verifiedAddresses = new Set();

function setContributorsSvgIdentity(log) {
  const address = log.getIn(['address', 'value']);
  if (!address) {
    return log;
  }

  const source = log.get('source');
  if (
    source === 'api' &&
    log.get('verifiedApplication') === 'contributors-svg'
  ) {
    verifiedAddresses.add(address);
    return log;
  }

  if (
    source === 'contributors-svg' &&
    !log.has('identity') &&
    log.getIn(['request', 'headers', 'user-agent']) === USER_AGENT &&
    verifiedAddresses.has(address)
  ) {
    return log.set('identity', IDENTITY);
  }

  return log;
}

module.exports = { setContributorsSvgIdentity };
