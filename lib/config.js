'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

class Config {
  constructor() {
    this.data = {
      port: 9123,
      dataFile: path.join(os.homedir(), '.iotdb', 'data.json'),
      logDir: path.join(os.homedir(), '.iotdb', 'logs'),
      pidDir: path.join(os.homedir(), '.iotdb'),
      backend: 'json',
      backendConfig: {},
    };
  }

  /**
   * Load config from multiple sources in priority order:
   * 1. CLI flags  (merged after all sources loaded)
   * 2. Local config file (./iotdb.config.json)
   * 3. Home config file (~/.iotdb/config.json)
   * 4. Environment variables (IOTDB_*)
   * 5. Defaults
   */
  load(cliFlags = {}) {
    // 4. Home config
    this._mergeFile(path.join(os.homedir(), '.iotdb', 'config.json'));

    // 3. Local config
    this._mergeFile(path.join(process.cwd(), 'iotdb.config.json'));

    // 2. Environment
    this._mergeEnv();

    // 1. CLI flags (highest priority)
    this._mergeFlags(cliFlags);

    return this.data;
  }

  /** Get a config value */
  get(key) {
    return this.data[key];
  }

  /** Set a config value */
  set(key, value) {
    this.data[key] = value;
  }

  /** Merge a JSON file if it exists */
  _mergeFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        Object.assign(this.data, fileData);
      }
    } catch (e) {
      // Silently skip malformed config files
    }
  }

  /** Merge environment variables prefixed with IOTDB_ */
  _mergeEnv() {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('IOTDB_')) {
        const configKey = this._envToKey(key);
        let value = process.env[key];

        // Try to parse numbers
        if (/^\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        }

        this.data[configKey] = value;
      }
    }
  }

  /** Merge CLI flags */
  _mergeFlags(flags) {
    const flagMap = {
      port: 'port',
      data: 'dataFile',
      config: 'config',
      backend: 'backend',
    };

    for (const [flag, key] of Object.entries(flagMap)) {
      if (flags[flag] !== undefined) {
        this.data[key] = flags[flag];
      }
    }

    if (flags.port) this.data.port = parseInt(flags.port, 10);
  }

  /** Convert IOTDB_PORT → port */
  _envToKey(envKey) {
    // Remove prefix and convert to camelCase
    const withoutPrefix = envKey.replace(/^IOTDB_/, '');
    const parts = withoutPrefix.toLowerCase().split('_');
    return parts
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
  }
}

module.exports = Config;
