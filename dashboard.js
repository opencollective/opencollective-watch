const express = require('express');
const { app } = require('@hyperwatch/hyperwatch');

// Serve @hyperwatch/dashboard under /dashboard on this instance. Skipped if
// the package isn't installed.
function mountDashboard() {
  let dashboard;
  try {
    dashboard = require('@hyperwatch/dashboard');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return;
    }
    throw err;
  }

  app.api.use('/dashboard', express.static(dashboard.distPath));
  app.api.get('/dashboard/*splat', (req, res) => {
    res.sendFile(dashboard.indexPath);
  });
}

module.exports = { mountDashboard };
