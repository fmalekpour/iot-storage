'use strict';

const fs = require('fs');

class PidManager {
  constructor(pidDir) {
    this.pidFile = require('path').join(pidDir, 'iot-storage.pid');
  }

  /** Write a PID to the file */
  write(pid) {
    // Ensure parent directory exists
    const dir = require('path').dirname(this.pidFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.pidFile, String(pid), 'utf-8');
  }

  /** Read the PID from file, or null if not present */
  read() {
    try {
      const content = fs.readFileSync(this.pidFile, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /** Check if the PID file exists on disk */
  exists() {
    return fs.existsSync(this.pidFile);
  }

  /**
   * Check whether the process identified by the PID (or the one in the file)
   * is currently alive.
   */
  isAlive(recentlySeenPid = null) {
    const pid = recentlySeenPid !== null ? recentlySeenPid : this.read();
    if (!pid) return false;

    try {
      // Signal 0 does not actually send a signal — it just checks
      // whether the calling process has permission to signal the target.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove the PID file */
  remove() {
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      // File already gone — fine
    }
  }

  /**
   * If the PID file exists but the process is dead, remove the stale file.
   * Returns true if cleanup happened.
   */
  cleanup() {
    const pid = this.read();
    if (pid && !this.isAlive(pid)) {
      this.remove();
      return true;
    }
    return false;
  }
}

module.exports = PidManager;
