const hyperwatch = require('@hyperwatch/hyperwatch');
const dotenv = require('dotenv');

const { pipeline, input, lib, plugins, modules, start } = hyperwatch;

const { identity, cloudflare, hostname, dnsbl, geoip, useragent } = plugins;

// Load config

dotenv.config();

// Connect Input

const websocketClientInput = input.websocket.create({
  name: 'WebSocket client (JSON standard format)',
  type: 'client',
  address: process.env.FRONTEND_HYPERWATCH_URL,
  reconnectOnClose: true,
  options: {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.FRONTEND_HYPERWATCH_USERNAME}:${process.env.FRONTEND_HYPERWATCH_SECRET}`,
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
  .registerNode('main');

// Console Output
const consoleFormatter = new lib.formatter.Formatter('console');

pipeline
  .getNode('main')
  .filter((log) => !log.getIn(['request', 'url']).match(/^\/_/))
  .filter((log) => !log.getIn(['request', 'url']).match(/^\/static/))
  // .filter((log) => !log.getIn(['request', 'url']).match(/^\/api/))
  .map((log) => console.log(consoleFormatter.format(log)));

// Start

modules.load();

start();
