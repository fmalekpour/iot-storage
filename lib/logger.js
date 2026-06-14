'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'iotdb.log');

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Return file descriptors for daemon stdio redirection.
   * The caller (daemon spawner) is responsible for closing these.
   */
  getFileDescriptors() {
    const outFd = fs.openSync(this.logFile, 'a');
    const errFd = fs.openSync(this.logFile, 'a');
    return { outFd, errFd };
  }

  /** Format a log line with timestamp */
  format(...args) {
    const ts = new Date().toISOString();
    const message = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');
    return `[${ts}] ${message}`;
  }

  /** Log to file directly (for daemon process internal use) */
  logToFile(...args) {
    try {
      const line = this.format(...args) + '\n';
      fs.appendFileSync(this.logFile, line, 'utf-8');
    } catch {
      // Nothing we can do if logging fails
    }
  }
}

module.exports = Logger;
