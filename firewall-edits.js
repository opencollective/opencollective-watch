// Firewall list edits (POST /firewall/lists/:id/add|remove) record who made
// them: the user (or service token) Cloudflare Access authenticated, taken
// from the JWT Access adds to every request (Cf-Access-Jwt-Assertion), checked
// against the Access team's keys. The entry's `source` becomes
// `<email> via <source sent by the client>`, e.g.
// `francois@opencollective.com via dashboard`.
//
// On when CLOUDFLARE_ACCESS_TEAM_DOMAIN (e.g. ofico.cloudflareaccess.com) and
// CLOUDFLARE_ACCESS_AUD (the Application Audience tag of the instance's Access
// application) are set: then edits without a valid Access JWT are refused.

const crypto = require('crypto');

const { app } = require('@hyperwatch/hyperwatch');

const EDIT_PATH = /^\/firewall\/lists\/[^/]+\/(add|remove)$/;
// Access rotates its keys every 6 weeks, publishing the next one in advance
const KEYS_TTL = 60 * 60 * 1000;

const decode = (part) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function accessVerifier({
  teamDomain,
  aud,
  fetch = globalThis.fetch,
  now = Date.now,
}) {
  const issuer = `https://${teamDomain}`;
  let keys;
  let fetchedAt = 0;

  async function getKeys(refresh) {
    if (!keys || refresh || now() - fetchedAt > KEYS_TTL) {
      const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
      if (!res.ok) {
        throw new Error(`Access keys: ${res.status} ${res.statusText}`);
      }
      const jwks = (await res.json()).keys || [];
      keys = new Map(
        jwks.map((jwk) => [
          jwk.kid,
          crypto.createPublicKey({ key: jwk, format: 'jwk' }),
        ]),
      );
      fetchedAt = now();
    }
    return keys;
  }

  // The identity in a valid token: the user's email, or the service token's
  // client ID. Throws when the token isn't valid.
  return async function verify(token) {
    const parts = (token || '').split('.');
    if (parts.length !== 3) {
      throw new Error('no Access token');
    }
    const [header, payload] = parts.slice(0, 2).map(decode);
    if (header.alg !== 'RS256') {
      throw new Error(`unexpected algorithm ${header.alg}`);
    }
    let key = (await getKeys()).get(header.kid);
    if (!key) {
      // A key published since the last fetch
      key = (await getKeys(true)).get(header.kid);
    }
    if (!key) {
      throw new Error('unknown key');
    }
    const signed = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], 'base64url'),
    );
    if (!signed) {
      throw new Error('invalid signature');
    }
    const seconds = now() / 1000;
    const audiences = [].concat(payload.aud);
    if (
      payload.iss !== issuer ||
      !audiences.includes(aud) ||
      !(payload.exp > seconds) ||
      (payload.nbf && payload.nbf > seconds)
    ) {
      throw new Error('token not for this application, or expired');
    }
    if (payload.email) {
      return payload.email;
    }
    if (payload.common_name) {
      return `service token ${payload.common_name}`;
    }
    throw new Error('no identity in the token');
  };
}

function attributionMiddleware(verify) {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !EDIT_PATH.test(req.path)) {
      return next();
    }
    let who;
    try {
      who = await verify(req.get('cf-access-jwt-assertion'));
    } catch (err) {
      res.status(403).json({ error: `firewall: edit refused, ${err.message}` });
      return;
    }
    const source = req.body && req.body.source;
    req.body = {
      ...req.body,
      source: source ? `${who} via ${source}` : who,
    };
    next();
  };
}

function attributeFirewallEdits() {
  const teamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CLOUDFLARE_ACCESS_AUD;
  if (!teamDomain || !aud) {
    return;
  }
  app.api.use(attributionMiddleware(accessVerifier({ teamDomain, aud })));
  // Right after the JSON body parser, so it sees req.body and runs before
  // the firewall routes, whenever they're registered
  const { stack } = app.api.router;
  const parser = stack.findIndex((layer) => layer.name === 'jsonParser');
  if (parser === -1) {
    throw new Error("firewall edits: Hyperwatch's JSON body parser not found");
  }
  stack.splice(parser + 1, 0, stack.pop());
}

module.exports = {
  accessVerifier,
  attributeFirewallEdits,
  attributionMiddleware,
};
