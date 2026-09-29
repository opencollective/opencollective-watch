// Basic Auth in front of the whole instance, HTTP and WebSocket, when
// WATCH_SECRET is set. The username is WATCH_USERNAME, `opencollective` by
// default.
//
// Temporary: Hyperwatch's standalone server has no option for it yet, so this
// patches it from outside. To remove it, delete this file and the
// basicAuth() calls in the configs.

const crypto = require('crypto');

const { app } = require('@hyperwatch/hyperwatch');
// The WebSocket server the standalone server hands upgrades to, bypassing
// Express
const wsServer = require('@hyperwatch/hyperwatch/src/app/ws-server');

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorized(req, username, password) {
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return false;
  }
  const credentials = Buffer.from(encoded, 'base64').toString();
  const separator = credentials.indexOf(':');
  if (separator === -1) {
    return false;
  }
  // Both compared, so the time doesn't tell which one is wrong
  const user = safeEqual(credentials.slice(0, separator), username);
  const pass = safeEqual(credentials.slice(separator + 1), password);
  return user && pass;
}

function basicAuth() {
  const password = process.env.WATCH_SECRET;
  if (!password) {
    return;
  }
  const username = process.env.WATCH_USERNAME || 'opencollective';

  // HTTP: first in Hyperwatch's app, before the routes it already registered
  app.api.use((req, res, next) => {
    if (authorized(req, username, password)) {
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Watch", charset="UTF-8"');
    res.status(401).send('Unauthorized');
  });
  const { stack } = app.api.router;
  stack.unshift(stack.pop());

  // WebSocket upgrades
  const handleUpgrade = wsServer.handleUpgrade;
  wsServer.handleUpgrade = (req, socket, head) => {
    if (authorized(req, username, password)) {
      return handleUpgrade(req, socket, head);
    }
    wsServer.reject(socket, 401, 'Unauthorized');
  };
}

module.exports = { basicAuth };
