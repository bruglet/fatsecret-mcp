#!/usr/bin/env node

/**
 * Modernized FatSecret MCP Server - E2E Opaque-Box Test Runner
 *
 * Runs Tiers 1-4 test suites against:
 * 1. Conformance Server (default - zero external dependencies, hermetic mock JWKS)
 * 2. Real Built Server (via --real-server or USE_REAL_SERVER=1)
 * 3. External Running Server (via --server-url <url> or MCP_SERVER_URL=<url>)
 *
 * Usage:
 *   npx tsx test/e2e/runner.ts [options]
 *
 * Options:
 *   --tier <1|2|3|4|all>   Run specific tier (default: all)
 *   --server-url <url>     Target external MCP server URL
 *   --real-server          Spawn src/index.ts or dist/index.js
 *   --help                 Show this help message
 */

import { parseArgs } from 'node:util';

const options = {
  tier: { type: 'string' as const, default: 'all' },
  'server-url': { type: 'string' as const },
  'real-server': { type: 'boolean' as const, default: false },
  help: { type: 'boolean' as const, default: false },
};

const { values } = parseArgs({
  options,
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
FatSecret MCP E2E Test Suite Runner

Usage:
  node --import tsx test/e2e/runner.ts [flags]

Flags:
  --tier <1|2|3|4|all>    Select test tier (default: all)
  --server-url <url>      Test against live running MCP server (or set MCP_SERVER_URL)
  --real-server           Spawn actual src/index.ts implementation
  --help                  Show help
`);
  process.exit(0);
}

if (values['server-url']) {
  process.env.MCP_SERVER_URL = values['server-url'];
}

if (values['real-server']) {
  process.env.USE_REAL_SERVER = '1';
}

const tier = values.tier?.toLowerCase() || 'all';

console.log('===============================================================');
console.log('       FatSecret MCP Modernization - E2E Test Suite            ');
console.log('===============================================================');
console.log(`Target Mode: ${process.env.MCP_SERVER_URL ? 'External Server (' + process.env.MCP_SERVER_URL + ')' : process.env.USE_REAL_SERVER === '1' ? 'Real Server Process' : 'Opaque Conformance Harness'}`);
console.log(`Executing Tier: ${tier.toUpperCase()}`);
console.log('---------------------------------------------------------------\n');

async function runSuites() {
  const startTime = Date.now();

  try {
    if (tier === 'all' || tier === '1' || tier === 'tier1') {
      console.log('Loading Tier 1: Feature Coverage (Features 1-6)...');
      await import('./tier1-feature-coverage.test.js');
    }

    if (tier === 'all' || tier === '2' || tier === 'tier2') {
      console.log('Loading Tier 2: Boundary & Corner Cases (Features 1-6)...');
      await import('./tier2-boundary-cases.test.js');
    }

    if (tier === 'all' || tier === '3' || tier === 'tier3') {
      console.log('Loading Tier 3: Cross-Feature Interactions...');
      await import('./tier3-cross-feature.test.js');
    }

    if (tier === 'all' || tier === '4' || tier === 'tier4') {
      console.log('Loading Tier 4: Real-World Scenarios...');
      await import('./tier4-real-world.test.js');
    }
  } catch (err) {
    console.error('Test Suite Initialization Failed:', err);
    process.exit(1);
  }
}

runSuites().catch((err) => {
  console.error('Unhandled runner error:', err);
  process.exit(1);
});
