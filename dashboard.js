const express = require('express');
const { app } = require('@hyperwatch/hyperwatch');

const SERVICES = require('./services');

// Public URL of a service's instance, for the dashboard's instance links.
// WATCH_INSTANCE_URL is a template, e.g.
// https://watch-staging-{service}.opencollective.com
function instanceUrl(service) {
  const template = process.env.WATCH_INSTANCE_URL;
  return template
    ? template.replace('{service}', service)
    : `http://localhost:${SERVICES[service].port}`;
}

// Serve @hyperwatch/dashboard under /dashboard on this instance, plus
// /dashboard.json describing the other instances. Skipped if the package
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
      instances: Object.entries(SERVICES).map(([name, { label }]) => ({
        name,
        label,
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
