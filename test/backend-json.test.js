'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const JsonBackend = require('../lib/backends/json');

describe('JSON Backend', () => {
  let backend;
  let tmpFile;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `iot-storage-test-${Date.now()}.json`);
    backend = new JsonBackend();
    await backend.connect({ dataFile: tmpFile });
  });

  afterEach(async () => {
    await backend.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  describe('upsert', () => {
    it('creates a new record with _path, _created, _updated', async () => {
      const record = await backend.upsert('/test/a', { value: 42 });
      expect(record._path).toBe('/test/a');
      expect(record.value).toBe(42);
      expect(record._created).toBeTruthy();
      expect(record._updated).toBeTruthy();
    });

    it('updates an existing record and preserves _created', async () => {
      const r1 = await backend.upsert('/test/b', { x: 1 });
      // Wait a tick to ensure _updated differs
      await new Promise(r => setTimeout(r, 10));
      const r2 = await backend.upsert('/test/b', { x: 2 });
      expect(r2._created).toBe(r1._created);
      expect(r2.x).toBe(2);
    });
  });

  describe('getExact', () => {
    it('returns null for missing path', async () => {
      expect(await backend.getExact('/nonexistent')).toBeNull();
    });

    it('returns the record for an existing path', async () => {
      await backend.upsert('/test/c', { name: 'hello' });
      const r = await backend.getExact('/test/c');
      expect(r.name).toBe('hello');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await backend.upsert('/sensors/temp', { value: 23.5, unit: 'C' });
      await backend.upsert('/sensors/humidity', { value: 65, unit: '%' });
      await backend.upsert('/sensors/room1/light', { value: 1, unit: 'bool' });
    });

    it('exact path returns the single record and children', async () => {
      const rows = await backend.query('/sensors/temp', [], null, 'asc', Infinity, 0);
      expect(rows.length).toBe(1);
      expect(rows[0].unit).toBe('C');
    });

    it('parent path returns all children', async () => {
      const rows = await backend.query('/sensors', [], null, 'asc', Infinity, 0);
      expect(rows.length).toBe(3);
    });

    it('+ wildcard matches one level', async () => {
      const rows = await backend.query('/sensors/+', [], null, 'asc', Infinity, 0);
      const paths = rows.map(r => r._path);
      expect(paths).toContain('/sensors/temp');
      expect(paths).toContain('/sensors/humidity');
      expect(paths).not.toContain('/sensors/room1/light');
    });

    it('# wildcard matches all levels', async () => {
      const rows = await backend.query('/sensors/#', [], null, 'asc', Infinity, 0);
      expect(rows.length).toBe(3);
    });

    it('filters with =', async () => {
      const rows = await backend.query('/sensors/+', [
        { column: 'unit', op: '=', value: 'C' },
      ], null, 'asc', Infinity, 0);
      expect(rows.length).toBe(1);
      expect(rows[0]._path).toBe('/sensors/temp');
    });

    it('filters with >', async () => {
      const rows = await backend.query('/sensors/+', [
        { column: 'value', op: '>', value: 50 },
      ], null, 'asc', Infinity, 0);
      expect(rows.length).toBe(1);
      expect(rows[0]._path).toBe('/sensors/humidity');
    });

    it('sorts ascending', async () => {
      const rows = await backend.query('/sensors/+', [], 'value', 'asc', Infinity, 0);
      expect(rows[0].value).toBeLessThan(rows[1].value);
    });

    it('sorts descending', async () => {
      const rows = await backend.query('/sensors/+', [], 'value', 'desc', Infinity, 0);
      expect(rows[0].value).toBeGreaterThan(rows[1].value);
    });

    it('applies limit', async () => {
      const rows = await backend.query('/sensors/#', [], null, 'asc', 2, 0);
      expect(rows.length).toBe(2);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await backend.upsert('/dev/a', { status: 'on', val: 10 });
      await backend.upsert('/dev/b', { status: 'off', val: 20 });
    });

    it('updates all matching paths', async () => {
      const count = await backend.update('/dev/+', { status: 'reset' }, []);
      expect(count).toBe(2);
      const a = await backend.getExact('/dev/a');
      expect(a.status).toBe('reset');
    });

    it('updates with filter', async () => {
      const count = await backend.update('/dev/+', { status: 'changed' }, [
        { column: 'val', op: '>', value: 15 },
      ]);
      expect(count).toBe(1);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await backend.upsert('/tmp/x', { data: 1 });
      await backend.upsert('/tmp/y', { data: 2 });
    });

    it('deletes all matching paths', async () => {
      const count = await backend.delete('/tmp/+', []);
      expect(count).toBe(2);
      expect(await backend.getExact('/tmp/x')).toBeNull();
    });

    it('deletes with filter', async () => {
      const count = await backend.delete('/tmp/+', [
        { column: 'data', op: '=', value: 1 },
      ]);
      expect(count).toBe(1);
      expect(await backend.getExact('/tmp/x')).toBeNull();
      expect(await backend.getExact('/tmp/y')).toBeTruthy();
    });
  });

  describe('persistence', () => {
    it('survives close and reconnect', async () => {
      await backend.upsert('/persist/test', { val: 'hello' });
      await backend.close();

      const b2 = new JsonBackend();
      await b2.connect({ dataFile: tmpFile });
      const r = await b2.getExact('/persist/test');
      expect(r.val).toBe('hello');
      await b2.close();
    });
  });

  // ── Field projection (GET /data/:parent/:field) ────────────────────────
  //
  // When a full path doesn't match a record, the server treats the last
  // segment as a field name on the parent record. These tests simulate
  // that logic directly against the backend.

  describe('field projection', () => {
    beforeEach(async () => {
      await backend.upsert('/sensors/humidity', { value: 65, unit: '%' });
    });

    const projectField = async (backend, fullPath) => {
      const lastSlash = fullPath.lastIndexOf('/');
      if (lastSlash <= 0) return null;
      const parentPath = fullPath.slice(0, lastSlash);
      const fieldName = fullPath.slice(lastSlash + 1);
      if (!fieldName || fieldName.startsWith('_')) return null;
      const parent = await backend.getExact(parentPath);
      if (parent && fieldName in parent) return parent[fieldName];
      return undefined; // field doesn't exist
    };

    it('returns the full record for an exact path', async () => {
      const record = await backend.getExact('/sensors/humidity');
      expect(record).toBeTruthy();
      expect(record.value).toBe(65);
      expect(record.unit).toBe('%');
    });

    it('returns a single field value via parent/field projection', async () => {
      const value = await projectField(backend, '/sensors/humidity/value');
      expect(value).toBe(65);
    });

    it('returns a string field via parent/field projection', async () => {
      const value = await projectField(backend, '/sensors/humidity/unit');
      expect(value).toBe('%');
    });

    it('returns null for system _-prefixed fields', async () => {
      const value = await projectField(backend, '/sensors/humidity/_created');
      expect(value).toBeNull();
    });

    it('returns null for _path system field', async () => {
      const value = await projectField(backend, '/sensors/humidity/_path');
      expect(value).toBeNull();
    });

    it('returns undefined for non-existent field', async () => {
      const value = await projectField(backend, '/sensors/humidity/nonexistent');
      expect(value).toBeUndefined();
    });

    it('returns undefined when parent does not exist', async () => {
      const value = await projectField(backend, '/nonexistent/parent/field');
      expect(value).toBeUndefined();
    });
  });
});
