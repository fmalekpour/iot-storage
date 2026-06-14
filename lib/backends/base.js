'use strict';

/**
 * Abstract backend interface.
 * All storage backends must implement these methods.
 *
 * Each record is keyed by its path (e.g., "/sensors/temp").
 * Values are plain objects with user-defined columns plus system columns
 * (_created and _updated which are ISO timestamp strings).
 */
class Backend {
  /** Initialize/connect the backend */
  async connect(config) {
    throw new Error('Not implemented');
  }

  /**
   * Insert or update a record at the given path.
   * @param {string} path  — the record path
   * @param {object} data  — column-value pairs to set
   * @returns {object} the stored record
   */
  async upsert(path, data) {
    throw new Error('Not implemented');
  }

  /**
   * Query records matching the given path pattern and optional filters.
   * @param {string}  pathPattern — path possibly with +/# wildcards, or exact
   * @param {Array}   filters     — array of { column, op, value }
   * @param {string}  sortBy      — column to sort by (or null)
   * @param {string}  sortDir     — 'asc' or 'desc'
   * @param {number}  limit       — max records to return (or Infinity)
   * @param {number}  offset      — number of records to skip (or 0)
   * @returns {Array<object>} array of matching records
   */
  async query(pathPattern, filters, sortBy, sortDir, limit, offset) {
    throw new Error('Not implemented');
  }

  /**
   * Update records matching the given path pattern and filters.
   * @param {string} pathPattern
   * @param {object} updates      — column-value pairs to set
   * @param {Array}  filters
   * @returns {number} number of records updated
   */
  async update(pathPattern, updates, filters) {
    throw new Error('Not implemented');
  }

  /**
   * Delete records matching the given path pattern and filters.
   * @param {string} pathPattern
   * @param {Array}  filters
   * @returns {number} number of records deleted
   */
  async delete(pathPattern, filters) {
    throw new Error('Not implemented');
  }

  /**
   * Get a single record by exact path.
   * @param {string} path
   * @returns {object|null} the record or null
   */
  async getExact(path) {
    throw new Error('Not implemented');
  }

  /** Close/cleanup the backend */
  async close() {
    throw new Error('Not implemented');
  }
}

module.exports = Backend;
