const dotenv = require('dotenv');

dotenv.config();

const chalk = require('chalk');
const hyperwatch = require('@hyperwatch/hyperwatch');

const { pipeline, input, plugins, modules, start, util } = hyperwatch;

const { cloudflare, hostname, dnsbl, geoip } = plugins;

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.API_HYPERWATCH_URL,
  reconnectOnClose: true,
  options: {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.API_HYPERWATCH_USERNAME}:${process.env.API_HYPERWATCH_SECRET}`,
      ).toString('base64')}`,
    },
  },
});

pipeline.registerInput(websocketClientInput);

pipeline
  .map((log) => cloudflare.augment(log))
  .map((log) => hostname.augment(log))
  // .map((log) => hostname.meta(log))
  .map((log) => dnsbl.augment(log))
  .map((log) => geoip.augment(log))
  .filter((log) => log.has('graphql'))
  .registerNode('main');

for (const application of ['frontend', 'images', 'rest']) {
  pipeline
    .getNode('main')
    .filter(
      (log) =>
        log.getIn(['request', 'headers', 'oc-application']) === application,
    )
    .registerNode(application);
}

pipeline.getNode('main').map((log) => {
  const application = log.getIn(['request', 'headers', 'oc-application']);

  console.log(
    chalk.red(log.getIn(['request', 'time']).slice(11)),

    chalk.white(
      application ||
        log.getIn(['hostname', 'value']) ||
        log.getIn(['address', 'value']),
    ),

    chalk.blue(log.getIn(['graphql', 'operationName'])),
    chalk.grey(JSON.stringify(log.getIn(['graphql', 'variables']).toJS())),

    chalk.blue(log.getIn(['request', 'headers', 'user-agent'])),

    log.get('executionTime') <= 100
      ? chalk.green(`${log.get('executionTime')}ms`)
      : log.get('executionTime') >= 1000
      ? chalk.red(`${log.get('executionTime')}ms`)
      : chalk.yellow(`${log.get('executionTime')}ms`),
  );

  return log;
});

modules.addresses.setMapper((entry, format) => {
  return {
    identity:
      entry.get('identity') ||
      entry.getIn(['opencollective', 'user', 'email']) ||
      entry.getIn(['opencollective', 'application', 'id']),
    hostname: entry.getIn(['address', 'hostname'])
      ? `${entry.getIn(['address', 'hostname'])}${
          entry.getIn(['hostname', 'verified']) ? '+' : ''
        }`
      : entry.getIn(['address', 'value']),
    // type: entry.getIn(['address', 'type']),
    // owner: entry.getIn(['address', 'owner']),
    cc: entry.getIn(['geoip', 'country']),
    reg: entry.getIn(['geoip', 'region']),
    city: entry.getIn(['geoip', 'city']),
    dc: entry.getIn(['cloudflare', 'data-center']),
    '15m': util.aggregateSpeed(entry, 'per_minute'),
    '24h': util.aggregateSpeed(entry, 'per_hour'),
    xbl: entry.getIn(['dnsbl', 'xbl'])
      ? format === 'txt'
        ? ' x '
        : true
      : format === 'txt'
      ? ''
      : false,
  };
});

modules.addresses.setEnricher((entry, log) => {
  for (const field of [
    'address',
    'hostname',
    'cloudflare',
    'geoip',
    'dnsbl',
    'opencollective',
  ]) {
    if (!entry.has(field) && log.has(field)) {
      entry = entry.set(field, log.get(field));
    }
  }

  if (
    !entry.has('identity') &&
    log.hasIn(['request', 'headers', 'oc-application'])
  ) {
    entry = entry.set(
      'identity',
      log.getIn(['request', 'headers', 'oc-application']),
    );
  }

  return entry;
});

modules.load();

start();
