'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SYSTEMD_SYSTEM_DIR = '/etc/systemd/system';
const SERVICE_NAME = 'iot-storage.service';
const SERVICE_PATH = path.join(SYSTEMD_SYSTEM_DIR, SERVICE_NAME);

/**
 * Check whether the current system supports systemd.
 * Returns true if we're on Linux, systemd is PID 1, and systemctl is available.
 */
function isSystemdAvailable() {
  if (os.platform() !== 'linux') return false;

  // systemd exposes /run/systemd/system for service management
  try {
    return fs.existsSync('/run/systemd/system');
  } catch {
    return false;
  }
}

/**
 * Generate the systemd unit file content.
 * @param {object} opts — CLI options (port, data, backend, config)
 * @returns {string} the unit file content
 */
function generateUnitFile(opts = {}) {
  const nodeBin = process.execPath;                        // e.g. /usr/bin/node
  const cliScript = path.resolve(__dirname, '..', 'bin', 'cli.js');
  const currentUser = os.userInfo().username;

  // Build the ExecStart command
  const execArgs = [nodeBin, cliScript, 'run'];

  const envLines = [];
  if (opts.port) {
    envLines.push(`Environment=IOT_STORAGE_PORT=${opts.port}`);
  }
  if (opts.data) {
    envLines.push(`Environment=IOT_STORAGE_DATA_FILE=${opts.data}`);
  }
  if (opts.backend) {
    envLines.push(`Environment=IOT_STORAGE_BACKEND=${opts.backend}`);
  }
  if (opts.config) {
    envLines.push(`Environment=IOT_STORAGE_CONFIG=${opts.config}`);
  }

  const unit = `[Unit]
Description=iot-storage — Path-based lightweight SQL database with REST API
Documentation=https://github.com/fmalekpour/iot-storage
After=network.target

[Service]
Type=simple
User=${currentUser}
ExecStart=${execArgs.join(' ')}
Restart=on-failure
RestartSec=5
${envLines.join('\n')}

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${path.join(os.homedir(), '.iot-storage')}

[Install]
WantedBy=multi-user.target
`;

  return unit;
}

/**
 * Install the systemd service unit file.
 * @param {object} opts — CLI options
 * @returns {{ alreadyInstalled: boolean, content: string }} result
 */
function install(opts = {}) {
  if (!isSystemdAvailable()) {
    throw new Error(
      'systemd is not available on this system. ' +
      'This command only works on Linux systems with systemd.'
    );
  }

  const unitContent = generateUnitFile(opts);

  if (fs.existsSync(SERVICE_PATH)) {
    const existing = fs.readFileSync(SERVICE_PATH, 'utf-8');
    if (existing === unitContent) {
      return { alreadyInstalled: true, content: unitContent };
    }
    // Overwrite with new content
    fs.writeFileSync(SERVICE_PATH, unitContent, 'utf-8');
    return { alreadyInstalled: false, updated: true, content: unitContent };
  }

  // Write the unit file (requires sudo in most cases)
  try {
    fs.writeFileSync(SERVICE_PATH, unitContent, 'utf-8');
  } catch (e) {
    if (e.code === 'EACCES') {
      throw new Error(
        `Permission denied writing to ${SERVICE_PATH}. ` +
        'Run this command with sudo.'
      );
    }
    throw e;
  }

  return { alreadyInstalled: false, updated: false, content: unitContent };
}

/**
 * Uninstall (remove) the systemd service unit file.
 * @returns {{ removed: boolean, message: string }}
 */
function uninstall() {
  if (!isSystemdAvailable()) {
    throw new Error(
      'systemd is not available on this system. ' +
      'This command only works on Linux systems with systemd.'
    );
  }

  if (!fs.existsSync(SERVICE_PATH)) {
    return { removed: false, message: 'No systemd unit file found — nothing to remove.' };
  }

  try {
    fs.unlinkSync(SERVICE_PATH);
  } catch (e) {
    if (e.code === 'EACCES') {
      throw new Error(
        `Permission denied removing ${SERVICE_PATH}. ` +
        'Run this command with sudo.'
      );
    }
    throw e;
  }

  return { removed: true, message: `Removed ${SERVICE_PATH}` };
}

/**
 * Print the current status of the systemd service, or the unit file location
 * if systemd isn't active.
 */
function showStatus() {
  if (!isSystemdAvailable()) {
    console.log('✗ systemd is not available on this system.');
    return;
  }

  if (!fs.existsSync(SERVICE_PATH)) {
    console.log('✗ systemd unit file not installed.');
    console.log('');
    console.log('Example install command:');
    console.log(`  sudo iot-storage systemd install -p 9123 -d /var/lib/iot/data.json`);
    return;
  }

  console.log(`Unit file: ${SERVICE_PATH}`);
  console.log('');
  console.log('To manage the service:');
  console.log(`  sudo systemctl start   ${SERVICE_NAME}`);
  console.log(`  sudo systemctl stop    ${SERVICE_NAME}`);
  console.log(`  sudo systemctl restart ${SERVICE_NAME}`);
  console.log(`  sudo systemctl status  ${SERVICE_NAME}`);
  console.log(`  sudo systemctl enable  ${SERVICE_NAME}   (start on boot)`);
  console.log(`  sudo systemctl disable ${SERVICE_NAME}   (don't start on boot)`);
  console.log('');
  console.log('View logs:');
  console.log(`  journalctl -u ${SERVICE_NAME} -f`);
}

module.exports = {
  isSystemdAvailable,
  generateUnitFile,
  install,
  uninstall,
  showStatus,
  SERVICE_NAME,
  SERVICE_PATH,
};
