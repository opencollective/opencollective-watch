const { merge } = require('lodash');

// hyperwatch.init() options shared by the service configs, on top of
// .hyperwatchrc:
// - HYPERWATCH_PERSISTENCE=true (or 1) saves aggregators and history on
//   shutdown and reloads them at start
// - HYPERWATCH_PERSISTENCE_BACKEND: where they are kept, `file` (default,
//   .hyperwatch-data/) or `s3`
// - HYPERWATCH_PERSISTENCE_S3_BUCKET, HYPERWATCH_PERSISTENCE_S3_REGION: the
//   bucket of the `s3` backend. Its credentials are read by the AWS SDK
//   (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), never by Watch
// - HYPERWATCH_HISTORY_CAPACITY overrides the number of requests kept on the
//   main node (/history, live logs), e.g. more locally than on Heroku. The
//   other nodes keep what .hyperwatchrc says
//
// Hyperwatch reads `enabled` as given in the environment (a string), and
// ignores the variables that aren't set (merge skips undefined).
function hyperwatchOptions(service, extra = {}) {
  const capacity = Number(process.env.HYPERWATCH_HISTORY_CAPACITY);
  return merge(
    {
      modules: {
        history: capacity > 0 ? { nodes: { main: capacity } } : {},
      },
      persistence: {
        enabled: process.env.HYPERWATCH_PERSISTENCE,
        namespace: service,
        backend: process.env.HYPERWATCH_PERSISTENCE_BACKEND,
        s3: {
          bucket: process.env.HYPERWATCH_PERSISTENCE_S3_BUCKET,
          region: process.env.HYPERWATCH_PERSISTENCE_S3_REGION,
        },
      },
    },
    extra,
  );
}

module.exports = { hyperwatchOptions };
