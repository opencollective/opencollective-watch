const { merge } = require('lodash');

// hyperwatch.init() options shared by the service configs, on top of
// .hyperwatchrc:
// - HYPERWATCH_PERSISTENCE=true saves aggregators and history on shutdown
// - HYPERWATCH_HISTORY_CAPACITY overrides the number of requests kept per
//   pipeline node (/history, live logs), e.g. more locally than on Heroku
function hyperwatchOptions(service, extra = {}) {
  const capacity = Number(process.env.HYPERWATCH_HISTORY_CAPACITY);
  return merge(
    {
      modules: {
        history: capacity > 0 ? { capacity } : {},
      },
      persistence: {
        enabled: process.env.HYPERWATCH_PERSISTENCE === 'true',
        namespace: service,
      },
    },
    extra,
  );
}

module.exports = { hyperwatchOptions };
