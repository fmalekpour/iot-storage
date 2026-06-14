'use strict';

const { Command } = require('commander');
const path = require('path');
const Config = require('./config');
const PidManager = require('./pid-manager');
const Logger = require('./logger');
const DaemonManager = require('./daemon');

const pkg = require('../package.json');

const program = new Command();

program
  .name('iot-storage')
  .description('Path-based lightweight SQL database — MQTT-inspired hierarchical records')
  .version(pkg.version);

// ── start ────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start iot-storage as a background daemon')
  .option('-p, --port <number>', 'Port to listen on (default: 9123)')
  .option('-d, --data <path>', 'Path to the JSON data file')
  .option('-b, --backend <name>', 'Storage backend (default: json)')
  .option('-c, --config <path>', 'Path to config file')
  .action((opts) => {
    const config = new Config();
    config.load(opts);

    const pidManager = new PidManager(config.get('pidDir'));
    const logger = new Logger(config.get('logDir'));
    const daemon = new DaemonManager(pidManager, logger);

    try {
      const pid = daemon.start(path.join(__dirname, 'server.js'), opts);
      console.log(`✓ iot-storage started (PID ${pid}) on port ${config.get('port')}`);
      console.log(`  Logs: ${logger.logFile}`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ── stop ─────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the iot-storage daemon')
  .action(async () => {
    const cfg = new Config();
    cfg.load();

    const pidManager = new PidManager(cfg.get('pidDir'));
    const logger = new Logger(cfg.get('logDir'));
    const daemon = new DaemonManager(pidManager, logger);

    try {
      await daemon.stop();
      console.log('✓ iot-storage stopped');
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ── restart ──────────────────────────────────────────────────────────────
program
  .command('restart')
  .description('Restart the iot-storage daemon')
  .option('-p, --port <number>', 'Port to listen on')
  .option('-d, --data <path>', 'Path to the JSON data file')
  .action(async (opts) => {
    const cfg = new Config();
    cfg.load();

    const pidManager = new PidManager(cfg.get('pidDir'));
    const logger = new Logger(cfg.get('logDir'));
    const daemon = new DaemonManager(pidManager, logger);

    try {
      // Stop if running
      if (daemon.isRunning()) {
        process.stdout.write('Stopping iot-storage... ');
        await daemon.stop();
        console.log('done');
      }

      // Start
      const pid = daemon.start(path.join(__dirname, 'server.js'), opts);
      console.log(`✓ iot-storage started (PID ${pid}) on port ${cfg.get('port')}`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ── run ──────────────────────────────────────────────────────────────────
program
  .command('run')
  .description('Run iot-storage in the foreground (debug mode)')
  .option('-p, --port <number>', 'Port to listen on (default: 9123)')
  .option('-d, --data <path>', 'Path to the JSON data file')
  .option('-b, --backend <name>', 'Storage backend (default: json)')
  .option('-c, --config <path>', 'Path to config file')
  .action((opts) => {
    const config = new Config();
    config.load(opts);

    // Store config for the server to pick up (avoids circular import issues)
    process.env.IOT_STORAGE_PORT = String(config.get('port'));
    process.env.IOT_STORAGE_DATA_FILE = config.get('dataFile');
    process.env.IOT_STORAGE_BACKEND = config.get('backend');

    console.log(`iot-storage v${pkg.version}`);
    console.log(`Starting on port ${config.get('port')}...`);

    // Run the server inline (foreground)
    require('./server');
  });

// ── status ───────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Check if iot-storage daemon is running')
  .action(() => {
    const cfg = new Config();
    cfg.load();

    const pidManager = new PidManager(cfg.get('pidDir'));
    const pid = pidManager.read();

    if (pid && pidManager.isAlive(pid)) {
      console.log(`✓ iot-storage is running (PID ${pid})`);
    } else {
      if (pidManager.exists()) {
        pidManager.cleanup();
      }
      console.log('✗ iot-storage is not running');
    }
  });

module.exports = program;
