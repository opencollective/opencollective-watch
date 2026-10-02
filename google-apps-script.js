// Google Apps Script (UrlFetchApp) calls come from Google's user-triggered
// fetchers ranges, shared by every script. The calling script is only known
// from the id at the end of its user agent:
//   Mozilla/5.0 (compatible; Google-Apps-Script; beanserver;
//   +https://script.google.com; id: UAEmdDd91fmB1vptehO2gWH3V0UgcuHwDAQ)

const net = require('net');

// Refreshed in Hyperwatch by `node scripts/fetch-google-ips.js`
const googleFetchersIps = require('@hyperwatch/hyperwatch/src/data/google-user-triggered-fetchers-ips.json');

const googleFetchers = new net.BlockList();
for (const cidr of googleFetchersIps) {
  const [address, prefix] = cidr.split('/');
  googleFetchers.addSubnet(
    address,
    Number(prefix),
    net.isIPv6(address) ? 'ipv6' : 'ipv4',
  );
}

const APPS_SCRIPT_ID = /\bGoogle-Apps-Script\b.*\bid: ([\w-]+)/;

function isGoogleFetcher(address) {
  const type = net.isIPv6(address) ? 'ipv6' : net.isIPv4(address) && 'ipv4';
  return Boolean(type) && googleFetchers.check(address, type);
}

function setAppsScriptIdentity(log) {
  if (log.has('identity')) {
    return log;
  }

  const userAgent = log.getIn(['request', 'headers', 'user-agent']) || '';
  const match = userAgent.match(APPS_SCRIPT_ID);
  // Any client can send this user agent: only trust it from Google's ranges
  if (!match || !isGoogleFetcher(log.getIn(['address', 'value']) || '')) {
    return log;
  }
  return log.set('identity', `apps-script:${match[1]}`);
}

module.exports = { setAppsScriptIdentity };
