'use strict';

// Development entry point. It does NOT run a Vite production build.
// index.js detects this flag and mounts Vite in middleware mode on the
// same HTTP server as the Express API, so UI + API + HMR all use one port.
process.env.CLAUDE_HARNESS_DEV = '1';
process.env.NODE_ENV = 'development';

const { createLogger } = require('../lib/logger');
const { main } = require('../index');
const log = createLogger('dev');

main().catch((error) => {
  log.error('Development server failed', { error });
  process.exitCode = 1;
});
