const { merge } = require('lodash');

// The firewall lists, in the order of their Cloudflare rules (the first
// matching list tags a request). They apply when no lists are stored yet;
// once stored (firewall.json, or the persistence storage), the stored lists
// win and these only add the missing ones. Each list is linked to its
// Cloudflare rule when the rule ID is set, and local only otherwise (tagging,
// no sync). A list stored unlinked stays unlinked: set the rule IDs before
// the lists are first edited or synced.
const FIREWALL_LISTS = [
  {
    id: 'block-ips',
    type: 'ip',
    action: 'block',
    rule: 'FIREWALL_BLOCK_IPS_RULE_ID',
  },
  {
    id: 'block-user-agents',
    type: 'user_agent',
    match: 'eq',
    action: 'block',
    rule: 'FIREWALL_BLOCK_USER_AGENTS_RULE_ID',
  },
  {
    id: 'challenge-user-agents',
    type: 'user_agent',
    match: 'eq',
    action: 'challenge',
    rule: 'FIREWALL_CHALLENGE_USER_AGENTS_RULE_ID',
  },
  {
    id: 'challenge-ips',
    type: 'ip',
    action: 'challenge',
    rule: 'FIREWALL_CHALLENGE_IPS_RULE_ID',
  },
  { id: 'monitor-ips', type: 'ip', action: 'monitor' },
  {
    id: 'monitor-user-agents',
    type: 'user_agent',
    match: 'eq',
    action: 'monitor',
  },
];

function firewallOptions() {
  const lists = [];
  for (const { rule, ...list } of FIREWALL_LISTS) {
    const ruleId = rule && process.env[rule];
    // eslint-disable-next-line camelcase
    lists.push(ruleId ? { ...list, cloudflare: { rule_id: ruleId } } : list);
  }
  return {
    lists,
    // Edits through the HTTP API (/firewall/lists/:id/add|remove) reach
    // Cloudflare when syncing: on behind Basic Auth (basic-auth.js), or with
    // FIREWALL_EDITS=true behind other authentication (Cloudflare Access)
    edits: process.env.WATCH_SECRET ? true : process.env.FIREWALL_EDITS,
    sync: { auto: process.env.FIREWALL_SYNC },
  };
}

// hyperwatch.init() options shared by the service configs, on top of
// .hyperwatchrc:
// - HYPERWATCH_PERSISTENCE=true (or 1) saves aggregators and history on
//   shutdown and reloads them at start
// - HYPERWATCH_PERSISTENCE_BACKEND: where they are kept, `file` (default,
//   .hyperwatch-data/) or `s3`
// - HYPERWATCH_PERSISTENCE_S3_BUCKET, HYPERWATCH_PERSISTENCE_S3_REGION: the
//   bucket of the `s3` backend. Its credentials are read by the AWS SDK
//   (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), never by Watch
// - HYPERWATCH_HISTORY_CAPACITY overrides the number of requests kept on the
//   main node (/history, live logs), e.g. more locally than on Heroku. The
//   other nodes keep what .hyperwatchrc says
// - FIREWALL_*_RULE_ID: the Cloudflare custom rule each firewall list is
//   linked to (see firewallOptions)
// - FIREWALL_EDITS=true (or 1) allows editing the lists without
//   WATCH_SECRET, e.g. behind Cloudflare Access only
// - FIREWALL_SYNC=true (or 1) syncs the linked lists with Cloudflare, with
//   CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID. One instance per zone:
//   production only
//
// Hyperwatch reads `enabled` and `auto` as given in the environment (a
// string), and ignores the variables that aren't set (merge skips
// undefined).
function hyperwatchOptions(service, extra = {}) {
  const capacity = Number(process.env.HYPERWATCH_HISTORY_CAPACITY);
  return merge(
    {
      modules: {
        history: capacity > 0 ? { nodes: { main: capacity } } : {},
        firewall: firewallOptions(),
      },
      persistence: {
        enabled: process.env.HYPERWATCH_PERSISTENCE,
        namespace: service,
        backend: process.env.HYPERWATCH_PERSISTENCE_BACKEND,
        s3: {
          bucket: process.env.HYPERWATCH_PERSISTENCE_S3_BUCKET,
          region: process.env.HYPERWATCH_PERSISTENCE_S3_REGION,
        },
      },
    },
    extra,
  );
}

module.exports = { hyperwatchOptions };
