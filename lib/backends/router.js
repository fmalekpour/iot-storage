'use strict';

const path = require('path');
const Backend = require('./base');
const JsonBackend = require('./json');

/**
 * Router Backend
 *
 * Dispatches operations to the correct JSON file based on an @namespace
 * prefix in the first segment of the record path.
 *
 *   /sensors/temp         →  data.json           (default)
 *   /@fleet-a/sensors/temp → fleet-a.json
 *   /@warehouse/devices   → warehouse.json
 *
 * Namespace files are created lazily on first access and stored in the
 * same directory as the default data.json file.
 *
 * Multi-namespace wildcards (@+, @#, and root-level #) query all backends.
 */
class Router extends Backend {
  constructor() {
    super();
    /**
     * Map of namespace name → JsonBackend instance.
     * Key `null` is the default backend (data.json).
     */
    this._backends = new Map();
    /** Base directory path for data files */
    this._dataDir = null;
    /** Base filename (e.g. "data.json") for deriving namespace filenames */
    this._baseFileName = null;
    /** Whether connect() has been called */
    this._connected = false;
  }

  // ── Backend interface ──────────────────────────────────────────────────

  async connect(config) {
    const filePath = config.dataFile;
    this._dataDir = path.dirname(filePath);
    this._baseFileName = path.basename(filePath);

    // Create and connect the default backend
    const defaultBackend = new JsonBackend();
    await defaultBackend.connect({ dataFile: filePath });
    this._backends.set(null, defaultBackend);

    this._connected = true;
  }

  async upsert(recordPath, data) {
    this._ensureConnected();
    const { namespace, localPath } = this._extractNamespace(recordPath);

    if (namespace === '*') {
      throw new Error(
        'Cannot INSERT or PUT to a wildcard namespace. ' +
        'Use a specific @namespace path, e.g. /@myapp/sensors/temp'
      );
    }

    const backend = await this._getBackend(namespace);
    const record = await backend.upsert(localPath, data);

    // Return a copy with the full path — don't mutate the stored record
    if (namespace !== null) {
      return {
        ...record,
        _path: recordPath,
        _namespace: namespace,
      };
    }

    return record;
  }

  async query(pathPattern, filters, sortBy, sortDir, limit, offset) {
    this._ensureConnected();
    const { namespace, localPath } = this._extractNamespace(pathPattern);

    if (namespace === '*') {
      return this._queryAll(pathPattern, filters, sortBy, sortDir, limit, offset);
    }

    const backend = await this._getBackend(namespace);
    const rows = await backend.query(localPath, filters, sortBy, sortDir, limit, offset);

    // Return copies with full paths — don't mutate stored records
    if (namespace !== null) {
      for (const row of rows) {
        row._path = '/@' + namespace + row._path;
        row._namespace = namespace;
      }
    }

    return rows;
  }

  async update(pathPattern, updates, filters) {
    this._ensureConnected();
    const { namespace, localPath } = this._extractNamespace(pathPattern);

    if (namespace === '*') {
      return this._updateAll(localPath, updates, filters);
    }

    const backend = await this._getBackend(namespace);
    return backend.update(localPath, updates, filters);
  }

  async delete(pathPattern, filters) {
    this._ensureConnected();
    const { namespace, localPath } = this._extractNamespace(pathPattern);

    if (namespace === '*') {
      return this._deleteAll(localPath, filters);
    }

    const backend = await this._getBackend(namespace);
    return backend.delete(localPath, filters);
  }

  async getExact(recordPath) {
    this._ensureConnected();
    const { namespace, localPath } = this._extractNamespace(recordPath);

    if (namespace === '*') {
      // A wildcard path can't match exactly one record
      return null;
    }

    const backend = await this._getBackend(namespace);
    const record = await backend.getExact(localPath);

    // Restore full path with namespace prefix
    if (record && namespace !== null) {
      record._path = recordPath;
      record._namespace = namespace;
    }

    return record;
  }

  async close() {
    for (const backend of this._backends.values()) {
      await backend.close();
    }
    this._backends.clear();
    this._connected = false;
  }

  // ── Namespace resolution ───────────────────────────────────────────────

  /**
   * Parse the namespace from a path pattern.
   *
   * @param {string} pathPattern — e.g. "/@fleet-a/sensors/temp"
   * @returns {{ namespace: string|null|'*', localPath: string }}
   *
   *   namespace = null     → default (data.json)
   *   namespace = 'fleet-a' → fleet-a.json
   *   namespace = '*'       → all namespace backends
   */
  _extractNamespace(pathPattern) {
    const segments = pathPattern.split('/').filter(s => s !== '');

    // Root-level wildcard # matches everything across all namespaces
    if (segments.length === 1 && segments[0] === '#') {
      return { namespace: '*', localPath: '/#' };
    }

    // Path with no segments (e.g. "/") → default
    if (segments.length === 0) {
      return { namespace: null, localPath: pathPattern };
    }

    const first = segments[0];

    // @-prefixed namespace
    if (first.startsWith('@')) {
      const nsName = first.slice(1); // strip the @

      // @+ or @# → wildcard across all namespaces
      if (nsName === '+' || nsName === '#') {
        return { namespace: '*', localPath: pathPattern };
      }

      // @name → specific namespace, strip prefix from local path
      const localPath = '/' + segments.slice(1).join('/') || '/';
      return { namespace: nsName, localPath };
    }

    // No @ prefix → default namespace
    return { namespace: null, localPath: pathPattern };
  }

  // ── Backend management ─────────────────────────────────────────────────

  /**
   * Get (or lazy-create) the JsonBackend for a namespace.
   * @param {string|null} namespace — null for default, string for named
   * @returns {Promise<JsonBackend>}
   */
  async _getBackend(namespace) {
    if (this._backends.has(namespace)) {
      return this._backends.get(namespace);
    }

    // Build the file path: <dataDir>/<namespace>.json
    const fileName = namespace === null
      ? this._baseFileName
      : `${namespace}.json`;
    const filePath = path.join(this._dataDir, fileName);

    const backend = new JsonBackend();
    await backend.connect({ dataFile: filePath });
    this._backends.set(namespace, backend);

    return backend;
  }

  /**
   * Get ALL active backends (including default).
   * @returns {Promise<Array<{ namespace: string|null, backend: JsonBackend }>>}
   */
  async _getAllBackends() {
    // We always have the default backend. Namespace backends are created
    // on-demand, so we can only query those that already exist on disk
    // or that we've already loaded. For wildcard operations, we scan the
    // data directory for *.json files to discover namespaces.

    const { readdirSync, existsSync } = require('fs');

    // Ensure the default backend exists
    const results = [{ namespace: null, backend: await this._getBackend(null) }];

    // Discover namespace files on disk (<name>.json, excluding data.json)
    try {
      if (existsSync(this._dataDir)) {
        const files = readdirSync(this._dataDir);
        for (const file of files) {
          const match = file.match(/^(.+)\.json$/);
          if (match && file !== this._baseFileName) {
            const ns = match[1];
            if (!results.some(r => r.namespace === ns)) {
              try {
                const backend = await this._getBackend(ns);
                results.push({ namespace: ns, backend });
              } catch {
                // Skip unreadable files
              }
            }
          }
        }
      }
    } catch {
      // If we can't read the directory, just use what we have in memory
      for (const [ns, backend] of this._backends.entries()) {
        if (ns !== null && !results.some(r => r.namespace === ns)) {
          results.push({ namespace: ns, backend });
        }
      }
    }

    return results;
  }

  // ── Multi-namespace operations ─────────────────────────────────────────

  /**
   * Rewrite a cross-namespace wildcard to a local wildcard for each backend.
   *   /@+/sensors/+  →  /sensors/+
   *   /#             →  /#
   */
  _toLocalWildcard(pathPattern) {
    const segments = pathPattern.split('/').filter(s => s !== '');

    // If the first segment is @+ or @#, strip it
    if (segments.length > 0 && segments[0] === '@+') {
      return '/' + segments.slice(1).join('/') || '/#';
    }
    if (segments.length > 0 && segments[0] === '@#') {
      return '/' + segments.slice(1).join('/') || '/#';
    }

    // For root-level /#, keep as-is (each backend handles its own /#)
    return pathPattern;
  }

  async _queryAll(pathPattern, filters, sortBy, sortDir, limit, offset) {
    const localPattern = this._toLocalWildcard(pathPattern);
    const allBackends = await this._getAllBackends();

    // Query each backend, tagging records with their namespace
    let allRows = [];
    for (const { namespace, backend } of allBackends) {
      const rows = await backend.query(localPattern, filters, sortBy, sortDir, Infinity, 0);
      for (const row of rows) {
        allRows.push({
          ...row,
          _namespace: namespace,
          // Reconstruct the full path with namespace prefix
          _path: namespace ? `/@${namespace}${row._path}` : row._path,
        });
      }
    }

    // Re-sort (each backend sorted independently, need global sort)
    if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1;
      allRows.sort((a, b) => {
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

    // Apply offset and limit globally
    if (offset > 0) {
      allRows = allRows.slice(offset);
    }
    if (limit !== Infinity) {
      allRows = allRows.slice(0, limit);
    }

    return allRows;
  }

  async _updateAll(pathPattern, updates, filters) {
    const localPattern = this._toLocalWildcard(pathPattern);
    const allBackends = await this._getAllBackends();

    let totalAffected = 0;
    for (const { backend } of allBackends) {
      totalAffected += await backend.update(localPattern, updates, filters);
    }

    return totalAffected;
  }

  async _deleteAll(pathPattern, filters) {
    const localPattern = this._toLocalWildcard(pathPattern);
    const allBackends = await this._getAllBackends();

    let totalDeleted = 0;
    for (const { backend } of allBackends) {
      totalDeleted += await backend.delete(localPattern, filters);
    }

    return totalDeleted;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _ensureConnected() {
    if (!this._connected) {
      throw new Error('Router backend not connected. Call connect() first.');
    }
  }

  /** Get a list of known namespace names (for debugging / introspection) */
  async getNamespaces() {
    const allBackends = await this._getAllBackends();
    return allBackends.map(b => b.namespace);
  }
}

module.exports = Router;
