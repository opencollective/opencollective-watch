const hyperwatch = require('@hyperwatch/hyperwatch');
const { pathToRegexp } = require('path-to-regexp');
const uuid = require('uuid');

const serverCount = 2;

const { pipeline, input, lib } = hyperwatch;

// Add Open Collective specific regexes

lib.useragent.addRegex('robot', {
  regex: '(opencollective-images)/(\\d+)\\.(\\d+)',
  family_replacement: 'Open Collective Images', // eslint-disable-line camelcase
});

// Connect Inputs (1 per live server)

for (let i = 0; i < serverCount; i++) {
  const websocketClientInput = input.websocket.create({
    name: 'WebSocket client (JSON standard format)',
    type: 'client',
    address: process.env.IMAGES_HYPERWATCH_URL,
    reconnectOnClose: true,
    username: process.env.IMAGES_HYPERWATCH_USERNAME,
    password: process.env.IMAGES_HYPERWATCH_SECRET,
    clientId: uuid.v4(),
  });

  pipeline.registerInput(websocketClientInput);
}

// Setup Pipeline and data augmentation

pipeline
  .getNode('main')
  .map((log) => {
    if (log.getIn(['agent', 'family']) === 'Open Collective Images') {
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

other.map((log) =>
  console.log(lib.logger.defaultFormatter.format(log, 'console')),
);
