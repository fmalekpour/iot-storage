'use strict';

const { Command } = require('commander');
const path = require('path');
const Config = require('./config');
const PidManager = require('./pid-manager');
const Logger = require('./logger');
const DaemonManager = require('./daemon');
const SystemdManager = require('./systemd');

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

// ── systemd ──────────────────────────────────────────────────────────────
const systemdCmd = program
  .command('systemd')
  .description('Manage iot-storage as a systemd service (Linux only)');

// systemd install
systemdCmd
  .command('install')
  .description('Install the systemd unit file (requires sudo)')
  .option('-p, --port <number>', 'Port to listen on (default: 9123)')
  .option('-d, --data <path>', 'Path to the JSON data file')
  .option('-b, --backend <name>', 'Storage backend (default: json)')
  .action((opts) => {
    try {
      const cfg = new Config();
      cfg.load(opts);

      // Build options with resolved defaults
      const installOpts = {
        port: cfg.get('port'),
        data: cfg.get('dataFile'),
        backend: cfg.get('backend'),
      };

      const result = SystemdManager.install(installOpts);

      if (result.alreadyInstalled && !result.updated) {
        console.log('✓ systemd unit file already installed and up-to-date.');
      } else {
        console.log('✓ systemd unit file installed.');
      }

      console.log(`  File: ${SystemdManager.SERVICE_PATH}`);
      console.log('');
      console.log('Example:');
      console.log(`  sudo iot-storage systemd install -p 9123 -d /var/lib/iot/data.json`);
      console.log('');
      console.log('Next steps:');
      console.log(`  sudo systemctl daemon-reload`);
      console.log(`  sudo systemctl enable --now ${SystemdManager.SERVICE_NAME}`);
      console.log('');
      console.log('Manage the service:');
      console.log(`  sudo systemctl start   ${SystemdManager.SERVICE_NAME}`);
      console.log(`  sudo systemctl stop    ${SystemdManager.SERVICE_NAME}`);
      console.log(`  sudo systemctl restart ${SystemdManager.SERVICE_NAME}`);
      console.log(`  sudo systemctl status  ${SystemdManager.SERVICE_NAME}`);
      console.log(`  sudo systemctl enable  ${SystemdManager.SERVICE_NAME}   (start on boot)`);
      console.log(`  sudo systemctl disable ${SystemdManager.SERVICE_NAME}   (don't start on boot)`);
      console.log('');
      console.log('View logs:');
      console.log(`  journalctl -u ${SystemdManager.SERVICE_NAME} -f`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// systemd uninstall
systemdCmd
  .command('uninstall')
  .description('Remove the systemd unit file (requires sudo)')
  .action(() => {
    try {
      const result = SystemdManager.uninstall();
      console.log(result.removed ? `✓ ${result.message}` : `✗ ${result.message}`);
      if (result.removed) {
        console.log('');
        console.log('Run these to clean up systemd state:');
        console.log(`  sudo systemctl daemon-reload`);
        console.log(`  sudo systemctl reset-failed ${SystemdManager.SERVICE_NAME}`);
      }
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// systemd status
systemdCmd
  .command('status')
  .description('Show systemd unit file status and management instructions')
  .action(() => {
    SystemdManager.showStatus();
  });

// systemd generate (dry-run — prints the unit file without installing)
systemdCmd
  .command('generate')
  .description('Print the systemd unit file to stdout (dry-run)')
  .option('-p, --port <number>', 'Port to listen on (default: 9123)')
  .option('-d, --data <path>', 'Path to the JSON data file')
  .option('-b, --backend <name>', 'Storage backend (default: json)')
  .action((opts) => {
    const cfg = new Config();
    cfg.load(opts);

    const installOpts = {
      port: cfg.get('port'),
      data: cfg.get('dataFile'),
      backend: cfg.get('backend'),
    };

    console.log(SystemdManager.generateUnitFile(installOpts));
  });

module.exports = program;
