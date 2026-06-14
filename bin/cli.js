#!/usr/bin/env node

'use strict';

// Internal daemon entry: when the daemon manager spawns a child process,
// it passes --internal-daemon. Skip the CLI parser and go straight to server.
if (process.argv.includes('--internal-daemon')) {
  // Extract the server script path and config from argv
  const scriptIdx = process.argv.indexOf('--internal-daemon') + 1;
  if (scriptIdx < process.argv.length) {
    require(process.argv[scriptIdx]);
  } else {
    require('../lib/server');
  }
  return;
}

// Normal CLI path
require('../lib/cli').parse(process.argv);
