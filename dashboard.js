const express = require('express');
const { app } = require('@hyperwatch/hyperwatch');

const SERVICES = require('./services');

// Public URL of a service's instance, for the dashboard's instance links.
// WATCH_INSTANCE_URL is the URL, or a template when several instances are
// published, e.g. https://watch-staging-{service}.opencollective.com
function instanceUrl(service) {
  const template = process.env.WATCH_INSTANCE_URL;
  return template
    ? template.replace('{service}', service)
    : `http://localhost:${SERVICES[service].port}`;
}

// The instances to link: the ones start.js runs (WATCH_SERVICES), or this
// one alone when started on its own
function runningServices(service) {
  const names = (process.env.WATCH_SERVICES || service)
    .split(',')
    .filter((name) => SERVICES[name]);
  return names.length ? names : [service];
}

// Serve @hyperwatch/dashboard under /dashboard on this instance, plus
// /dashboard.json describing the running instances. Skipped if the package
// isn't installed.
function mountDashboard(service) {
  let dashboard;
  try {
    dashboard = require('@hyperwatch/dashboard');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return;
    }
    throw err;
  }

  app.api.get('/dashboard.json', (req, res) => {
    res.json({
      name: service,
      instances: runningServices(service).map((name) => ({
        name,
        label: SERVICES[name].label,
        url: instanceUrl(name),
      })),
    });
  });
  app.api.use('/dashboard', express.static(dashboard.distPath));
  app.api.get('/dashboard/*splat', (req, res) => {
    res.sendFile(dashboard.indexPath);
  });
}

module.exports = { mountDashboard };
