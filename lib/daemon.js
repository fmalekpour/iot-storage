'use strict';

const { spawn } = require('child_process');

class DaemonManager {
  constructor(pidManager, logger) {
    this.pidManager = pidManager;
    this.logger = logger;
  }

  /**
   * Start the server as a daemon (detached background process).
   * @param {string} serverScript — absolute path to the server entry module
   * @param {object}  cliArgs     — key/value pairs to pass as CLI flags
   * @returns {number} the PID of the spawned daemon
   */
  start(serverScript, cliArgs = {}) {
    // Auto-cleanup any stale PID file
    this.pidManager.cleanup();

    if (this.pidManager.isAlive()) {
      const pid = this.pidManager.read();
      throw new Error(`iot-storage is already running (PID ${pid})`);
    }

    // Build environment for the child — pass config via env vars
    const childEnv = { ...process.env, IOT_STORAGE_DAEMON: '1' };
    if (cliArgs.port) childEnv.IOT_STORAGE_PORT = String(cliArgs.port);
    if (cliArgs.data) childEnv.IOT_STORAGE_DATA_FILE = cliArgs.data;
    if (cliArgs.backend) childEnv.IOT_STORAGE_BACKEND = cliArgs.backend;

    const args = [serverScript];

    const { outFd, errFd } = this.logger.getFileDescriptors();

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      env: childEnv,
    });

    this.pidManager.write(child.pid);

    // Detach so the parent can exit independently
    child.unref();

    return child.pid;
  }

  /**
   * Stop a running daemon gracefully, then forcefully.
   * Returns a promise that resolves when the daemon has stopped.
   */
  async stop() {
    const pid = this.pidManager.read();
    if (!pid) {
      throw new Error('iot-storage is not running (no PID file)');
    }
    if (!this.pidManager.isAlive(pid)) {
      this.pidManager.remove();
      throw new Error('iot-storage PID file existed but process was already dead — cleaned up');
    }

    // Send graceful shutdown signal
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      this.pidManager.remove();
      throw new Error(`Failed to send stop signal: ${e.message}`);
    }

    // Poll for up to 5 seconds
    const maxWait = 5000;
    const pollInterval = 100;
    let waited = 0;

    while (waited < maxWait) {
      if (!this.pidManager.isAlive(pid)) {
        this.pidManager.remove();
        return true;
      }
      await this._sleep(pollInterval);
      waited += pollInterval;
    }

    // Force kill after timeout
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* already dead */ }
    this.pidManager.remove();
    return true;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Check if the daemon is running */
  isRunning() {
    return this.pidManager.isAlive();
  }
}

module.exports = DaemonManager;
