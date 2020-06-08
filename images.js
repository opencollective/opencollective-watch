const hyperwatch = require('@hyperwatch/hyperwatch');
const dotenv = require('dotenv');
const { pathToRegexp } = require('path-to-regexp');

const { pipeline, input, lib, plugins, modules, start } = hyperwatch;

const { identity, cloudflare, hostname, dnsbl, geoip, useragent } = plugins;

// Load config

dotenv.config();

// Add Open Collective specific regexes

lib.useragent.addRegex('robot', {
  regex: '(opencollective-images)/(\\d+)\\.(\\d+)',
  family_replacement: 'Open Collective Images', // eslint-disable-line camelcase
});

// Connect Input

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

// Setup Pipeline and data augmentation

pipeline
  .map((log) => cloudflare.augment(log))
  .map((log) => hostname.augment(log))
  .map((log) => dnsbl.augment(log))
  .map((log) => geoip.augment(log))
  .map((log) => useragent.augment(log))
  .map((log) => identity.augment(log))
  .map((log) => {
    if (log.getIn(['useragent', 'family']) === 'Open Collective Images') {
      // check secret
      log = log.set('identity', 'Open Collective Images');
    }

    return log;
  })
  .registerNode('main');

// Create node based on Express Routes

const routes = {
  'github-avatar': pathToRegexp(
    '/github/:githubUsername/:image(avatar)/:style(rounded|square)?/:height?.:format(png)',
  ),
  avatar: pathToRegexp(
    '/:collectiveSlug/:hash?/:image(avatar|logo)/:style(rounded|square)?/:height?/:width?.:format(txt|png|jpg|svg)',
  ),
  background: pathToRegexp(
    '/:collectiveSlug/:hash?/background/:height?/:width?.:format(png|jpg)',
  ),
  'banner-contributors': pathToRegexp('/:collectiveSlug/contributors.svg'),
  banner: pathToRegexp('/:collectiveSlug/:backerType.svg'),
  'banner-tiers': pathToRegexp('/:collectiveSlug/tiers/:tierSlug.svg'),
  badge: pathToRegexp('/:collectiveSlug/:backerType/badge.svg'),
  'badge-tiers': pathToRegexp('/:collectiveSlug/tiers/:tierSlug/badge.svg'),
  'github-readme-avatar': pathToRegexp(
    '/:collectiveSlug/:backerType/:position/avatar.:format(png|jpg|svg)?',
  ),
  'github-readme-website': pathToRegexp(
    '/:collectiveSlug/:backerType/:position/website',
  ),
  'github-readme-avatar-tiers': pathToRegexp(
    '/:collectiveSlug/tiers/:tierSlug/:position/avatar.:format(png|jpg|svg)?',
  ),
  'github-readme-website-tiers': pathToRegexp(
    '/:collectiveSlug/tiers/:tierSlug/:position/website',
  ),
  proxy: pathToRegexp('/proxy/images'),
};

let node, other;
for (const [name, regex] of Object.entries(routes)) {
  [node, other] = (other || pipeline.getNode('main')).split((log) =>
    regex.test(log.getIn(['request', 'url']).split('?')[0]),
  );
  node.registerNode(name);
}
other.registerNode('other');

// Console Output

const consoleFormatter = new lib.formatter.Formatter('console');

other.map((log) => console.log(consoleFormatter.format(log)));

// Start

modules.load();

start();
