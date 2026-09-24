// The Open Collective services Watch follows, one Hyperwatch process each.
// Ports are fixed so the processes, the dashboard links and the Cloudflare
// Tunnel routes (docs/heroku.md) agree.
module.exports = {
  api: { label: 'API', port: 3360 },
  frontend: { label: 'Frontend', port: 3300 },
  images: { label: 'Images', port: 3301 },
  rest: { label: 'REST', port: 3303 },
};
