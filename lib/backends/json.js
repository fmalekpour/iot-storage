'use strict';

const fs = require('fs');
const path = require('path');
const Backend = require('./base');
const { wildcardToRegex } = require('../wildcard');

class JsonBackend extends Backend {
  constructor() {
    super();
    /** @type {Object<string, Object>} path → record mapping */
    this._data = {};
    this._filePath = null;
  }

  async connect(config) {
    this._filePath = config.dataFile;
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this._load();
  }

  async upsert(recordPath, data) {
    const now = new Date().toISOString();
    const existing = this._data[recordPath];

    const record = {
      ...(existing || {}),
      ...data,
      _path: recordPath,
      _created: existing ? existing._created : now,
      _updated: now,
    };

    this._data[recordPath] = record;
    this._save();
    return record;
  }

  async query(pathPattern, filters, sortBy, sortDir, limit, offset) {
    // Get matching paths
    const paths = this._matchPaths(pathPattern);

    // Get records
    let records = paths.map(p => ({ ...this._data[p] }));

    // Apply filters
    if (filters && filters.length > 0) {
      records = records.filter(r => this._applyFilters(r, filters));
    }

    // Sort
    if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1;
      records.sort((a, b) => {
        const va = a[sortBy];
        const vb = b[sortBy];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
          return (va - vb) * dir;
        }
        return String(va).localeCompare(String(vb)) * dir;
      });
    }

    // Apply offset and limit
    if (offset > 0) {
      records = records.slice(offset);
    }
    if (limit !== Infinity) {
      records = records.slice(0, limit);
    }

    return records;
  }

  async update(pathPattern, updates, filters) {
    const paths = this._matchPaths(pathPattern);
    let updated = 0;
    const now = new Date().toISOString();

    for (const p of paths) {
      const record = this._data[p];
      if (!filters || filters.length === 0 || this._applyFilters(record, filters)) {
        Object.assign(record, updates);
        record._updated = now;
        updated++;
      }
    }

    if (updated > 0) {
      this._save();
    }

    return updated;
  }

  async delete(pathPattern, filters) {
    const paths = this._matchPaths(pathPattern);
    let deleted = 0;

    for (const p of paths) {
      if (!filters || filters.length === 0 || this._applyFilters(this._data[p], filters)) {
        delete this._data[p];
        deleted++;
      }
    }

    if (deleted > 0) {
      this._save();
    }

    return deleted;
  }

  async getExact(recordPath) {
    return this._data[recordPath] ? { ...this._data[recordPath] } : null;
  }

  async close() {
    this._save();
    this._data = {};
  }

  // ── Private helpers ────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf-8');
        this._data = JSON.parse(raw);
      }
    } catch {
      this._data = {};
    }
  }

  _save() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (e) {
      // Log but don't crash — the data is still in memory
      console.error(`[iot-storage] Failed to save data file: ${e.message}`);
    }
  }

  /**
   * Return all paths that match the query pattern.
   * Supports MQTT-style + and # wildcards.
   */
  _matchPaths(pathPattern) {
    const allPaths = Object.keys(this._data);
    const regex = wildcardToRegex(pathPattern);

    if (regex === null) {
      // Exact match or parent path: return the record itself AND all children
      // MQTT-style: fetching a parent returns all sub-records
      if (this._data[pathPattern]) {
        // Also include children
        const results = [pathPattern];
        for (const p of allPaths) {
          if (p !== pathPattern && p.startsWith(pathPattern + '/')) {
            results.push(p);
          }
        }
        return results;
      }
      // No exact record — return only children
      return allPaths.filter(p => p.startsWith(pathPattern + '/'));
    }

    return allPaths.filter(p => regex.test(p));
  }

  _applyFilters(record, filters) {
    for (const f of filters) {
      if (!this._filterMatches(record, f)) {
        return false;
      }
    }
    return true;
  }

  _filterMatches(record, { column, op, value }) {
    const recordValue = record[column];

    switch (op) {
      case '=': case '==':
        return recordValue == value;
      case '!=': case '<>':
        return recordValue != value;
      case '>':
        return Number(recordValue) > Number(value);
      case '<':
        return Number(recordValue) < Number(value);
      case '>=':
        return Number(recordValue) >= Number(value);
      case '<=':
        return Number(recordValue) <= Number(value);
      case 'LIKE': {
        if (recordValue == null) return false;
        // Convert SQL LIKE pattern to regex
        const pattern = String(value)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        return new RegExp('^' + pattern + '$', 'i').test(String(recordValue));
      }
      case 'IN': {
        if (!Array.isArray(value)) return false;
        return value.includes(recordValue);
      }
      case 'IS':
        if (value === null || String(value).toUpperCase() === 'NULL') {
          return recordValue == null;
        }
        return recordValue === value;
      case 'IS NOT':
        if (value === null || String(value).toUpperCase() === 'NULL') {
          return recordValue != null;
        }
        return recordValue !== value;
      default:
        return true;
    }
  }
}

module.exports = JsonBackend;
