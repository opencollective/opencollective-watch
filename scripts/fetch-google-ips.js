// Refresh data/google-user-triggered-fetchers-ips.json:
//   node scripts/fetch-google-ips.js
//
// Google publishes the ranges its user-triggered fetchers run from at
// https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers.
// Google Apps Script (UrlFetchApp) fetches from them, e.g. 34.116.28.0/27.

const fs = require('fs');
const path = require('path');

const url =
  'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json';
const file = path.join(
  __dirname,
  '..',
  'data',
  'google-user-triggered-fetchers-ips.json',
);

async function main() {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const { prefixes } = await res.json();
  const cidrs = (prefixes || [])
    .map((prefix) => prefix.ipv4Prefix || prefix.ipv6Prefix)
    .filter(Boolean);
  if (cidrs.length === 0) {
    throw new Error('Empty list, keeping the current file');
  }
  fs.writeFileSync(file, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${path.basename(file)}: ${cidrs.length} CIDRs`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
