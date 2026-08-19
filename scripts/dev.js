'use strict';

// Development entry point. It does NOT run a Vite production build.
// index.js detects this flag and mounts Vite in middleware mode on the
// same HTTP server as the Express API, so UI + API + HMR all use one port.
process.env.CLAUDE_HARNESS_DEV = '1';
process.env.NODE_ENV = 'development';

const { main } = require('../index');

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
