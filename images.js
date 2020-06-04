const dotenv = require('dotenv');

dotenv.config();

const chalk = require('chalk');
const hyperwatch = require('@hyperwatch/hyperwatch');

const { pipeline, input, plugins, modules, start, util } = hyperwatch;

const { cloudflare, hostname, dnsbl, geoip, useragent } = plugins;

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.IMAGES_HYPERWATCH_URL,
  reconnectOnClose: true,
  options: {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.IMAGES_HYPERWATCH_USERNAME}:${process.env.IMAGES_HYPERWATCH_SECRET}`,
      ).toString('base64')}`,
    },
  },
});

pipeline.registerInput(websocketClientInput);

pipeline
  .map((log) => cloudflare.augment(log))
  .map((log) => hostname.augment(log))
  .map((log) => dnsbl.augment(log))
  .map((log) => geoip.augment(log))
  .map((log) => useragent.augment(log))
  .registerNode('main');

function getAgent(entry) {
  const agent = entry.get('agent');
  if (!agent) {
    return;
  }
  if (agent.get('family') === 'Other' || !agent.get('family')) {
    return;
  }
  if (!agent.get('major')) {
    return agent.get('family');
  }
  return `${agent.get('family')} ${agent.get('major')}`;
}

function getOs(entry) {
  const os = entry.getIn(['agent', 'os']);
  if (!os) {
    return;
  }
  if (os.get('family') === 'Other' || !os.get('family')) {
    return;
  }
  if (os.get('family') === 'Mac OS X') {
    return 'macOS';
  }
  return os.get('family');
}

pipeline.getNode('main').map((log) => {
  const application = log.getIn(['request', 'headers', 'oc-application']);

  console.log(
    chalk.red(log.getIn(['request', 'time']).slice(11)),

    chalk.blue(`${getAgent(log)}`),

    chalk.white(
      application ||
        log.getIn(['hostname', 'value']) ||
        log.getIn(['address', 'value']),
    ),

    chalk.blue(log.getIn(['request', 'method'])),
    chalk.grey(log.getIn(['request', 'url'])),
    chalk.green(log.getIn(['response', 'status'])),

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
    hostname: entry.getIn(['address', 'hostname'])
      ? `${entry.getIn(['address', 'hostname'])}${
          entry.getIn(['hostname', 'verified']) ? '+' : ''
        }`
      : entry.getIn(['address', 'value']),

    agent: getAgent(entry),
    os: getOs(entry),

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
    'agent',
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
