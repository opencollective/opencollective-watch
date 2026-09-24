const http = require('http');

const cors = require('cors');
const express = require('express');
const expressWs = require('express-ws');

// Initialize Hyperwatch pipeline and aggregators defined in api.js
require('./api');
// require('./frontend');
// require('./images');
// require('./rest');

const hyperwatch = require('@hyperwatch/hyperwatch');

// Start the Hyperwatch pipeline so inputs connect to websockets
hyperwatch.pipeline.start();

const PORT = process.env.PORT || 3333;

const app = express();
const server = http.createServer(app);
expressWs(app, server);

app.use(cors());
app.use(express.json());

// Optional: simple health endpoint for external checks
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Mount Hyperwatch API (status, identities, addresses, logs, aggregators, and
// the dashboard mounted by api.js)
app.use('/', hyperwatch.app.api);

// Mount Hyperwatch WebSocket endpoints (e.g. /logs/main)
app.use('/', hyperwatch.app.websocket);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Express server listening on http://localhost:${PORT}`);
});
