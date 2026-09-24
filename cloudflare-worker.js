// Requests made by another Cloudflare Worker all come from the same shared
// address. The calling Worker is only known from its cf-worker header, which
// our own Worker (opencollective.com) forwards as oc-client-worker.

// Cloudflare Workers egress, e.g. 2a06:98c0:3600::103
const WORKERS_EGRESS_PREFIX = '2a06:98c0:3600:';

function getClientWorker(log) {
  const address = log.getIn(['address', 'value']);
  // Clients can send these headers themselves: only trust them from Workers
  if (!address || !address.startsWith(WORKERS_EGRESS_PREFIX)) {
    return;
  }

  const headers = log.getIn(['request', 'headers']);
  if (headers.get('oc-client-worker')) {
    return headers.get('oc-client-worker');
  }
  // Not proxied by our Worker (e.g. direct API calls)
  if (
    headers.get('cf-worker') &&
    headers.get('cf-worker') !== 'opencollective.com'
  ) {
    return headers.get('cf-worker');
  }
}

function setClientWorkerIdentity(log) {
  if (log.has('identity')) {
    return log;
  }

  const clientWorker = getClientWorker(log);
  return clientWorker ? log.set('identity', `worker:${clientWorker}`) : log;
}

module.exports = { setClientWorkerIdentity };
