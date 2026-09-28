// Slow request thresholds, the same for every service and node
const SLOW = 300;
const EXTRA_SLOW = 1000;

// Registers `${prefix}slow` and `${prefix}extra-slow` below `parent`
function registerSlowNodes(parent, { prefix = '' } = {}) {
  parent
    .filter(
      (log) => log.get('executionTime') > SLOW,
      `executionTime > ${SLOW}ms`,
    )
    .registerNode(`${prefix}slow`);

  parent
    .filter(
      (log) => log.get('executionTime') > EXTRA_SLOW,
      `executionTime > ${EXTRA_SLOW}ms`,
    )
    .registerNode(`${prefix}extra-slow`);
}

module.exports = { registerSlowNodes };
