#!/usr/bin/env node

'use strict';

// Internal daemon entry: when the daemon manager spawns a child process,
// it sets IOT_STORAGE_DAEMON=1. Skip the CLI parser and go straight to server.
if (process.env.IOT_STORAGE_DAEMON) {
  require(require('path').resolve(process.argv[2] || '../lib/server'));
  return;
}

// Normal CLI path
require('../lib/cli').parse(process.argv);
