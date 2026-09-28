// The Hyperwatch configs Watch can run, one process each. Ports are fixed so
// the processes, the dashboard links and the Cloudflare Tunnel routes
// (docs/heroku.md) agree.
module.exports = {
  // The four Open Collective services in one pipeline (all.js), the default
  all: { label: 'All', port: 3399 },
  // One service each, started when asked for (npm start -- api …)
  api: { label: 'API', port: 3360, optional: true },
  frontend: { label: 'Frontend', port: 3300, optional: true },
  images: { label: 'Images', port: 3301, optional: true },
  rest: { label: 'REST', port: 3303, optional: true },
};
