'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const Router = require('../lib/backends/router');

describe('Router Backend (Namespaces)', () => {
  let router;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `iot-storage-router-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    router = new Router();
    await router.connect({ dataFile: path.join(tmpDir, 'data.json') });
  });

  afterEach(async () => {
    await router.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ── Default namespace (no @ prefix) ────────────────────────────────────

  describe('default namespace', () => {
    it('upserts and queries without @ prefix', async () => {
      await router.upsert('/sensors/temp', { value: 23.5 });
      const rows = await router.query('/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]._path).toBe('/sensors/temp');
      expect(rows[0].value).toBe(23.5);
      expect(rows[0]._namespace).toBeUndefined();
    });

    it('getExact returns record without _namespace', async () => {
      await router.upsert('/sensors/temp', { value: 23.5 });
      const record = await router.getExact('/sensors/temp');
      expect(record.value).toBe(23.5);
      expect(record._namespace).toBeUndefined();
      expect(record._path).toBe('/sensors/temp');
    });
  });

  // ── Named namespace (@prefix) ──────────────────────────────────────────

  describe('named namespace', () => {
    beforeEach(async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5, unit: 'C' });
      await router.upsert('/@fleet-a/sensors/humidity', { value: 65, unit: '%' });
      await router.upsert('/@fleet-a/devices/pump', { status: 'on' });
    });

    it('upsert returns record with full _path and _namespace', async () => {
      const record = await router.upsert('/@fleet-a/sensors/new', { x: 1 });
      expect(record._path).toBe('/@fleet-a/sensors/new');
      expect(record._namespace).toBe('fleet-a');
    });

    it('query returns records with full _path', async () => {
      const rows = await router.query('/@fleet-a/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row._path).toMatch(/^\/@fleet-a\//);
        expect(row._namespace).toBe('fleet-a');
      }
    });

    it('getExact returns record with full _path', async () => {
      const record = await router.getExact('/@fleet-a/sensors/temp');
      expect(record._path).toBe('/@fleet-a/sensors/temp');
      expect(record._namespace).toBe('fleet-a');
      expect(record.value).toBe(23.5);
    });

    it('update works within a namespace', async () => {
      const count = await router.update('/@fleet-a/sensors/+', { unit: 'F' }, []);
      expect(count).toBe(2);
      const record = await router.getExact('/@fleet-a/sensors/temp');
      expect(record.unit).toBe('F');
    });

    it('delete works within a namespace', async () => {
      const count = await router.delete('/@fleet-a/sensors/+', []);
      expect(count).toBe(2);
      const record = await router.getExact('/@fleet-a/sensors/temp');
      expect(record).toBeNull();
      // devices/pump should still exist
      expect(await router.getExact('/@fleet-a/devices/pump')).toBeTruthy();
    });
  });

  // ── Multiple namespaces ────────────────────────────────────────────────

  describe('multiple namespaces', () => {
    beforeEach(async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5 });
      await router.upsert('/@fleet-b/sensors/temp', { value: 30.0 });
      await router.upsert('/sensors/temp', { value: 18.0 });
    });

    it('queries only the specified namespace', async () => {
      const rows = await router.query('/@fleet-a/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]._path).toBe('/@fleet-a/sensors/temp');
    });

    it('cross-namespace query with @+ returns records from all namespaces', async () => {
      const rows = await router.query('/@+/sensors/+', [], null, 'asc', 1e9, 0);
      const paths = rows.map(r => r._path);
      expect(paths).toContain('/@fleet-a/sensors/temp');
      expect(paths).toContain('/@fleet-b/sensors/temp');
      expect(paths).toContain('/sensors/temp');
      expect(rows).toHaveLength(3);
    });

    it('cross-namespace query includes _namespace metadata', async () => {
      const rows = await router.query('/@+/sensors/+', [], null, 'asc', 1e9, 0);
      const nss = rows.map(r => r._namespace);
      expect(nss).toContain('fleet-a');
      expect(nss).toContain('fleet-b');
      expect(nss).toContain(null);
    });

    it('root-level # queries all namespaces', async () => {
      const rows = await router.query('/#', [], null, 'asc', 1e9, 0);
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it('update across namespaces with @+', async () => {
      const count = await router.update('/@+/sensors/+', { unit: 'updated' }, []);
      expect(count).toBe(3);
    });

    it('delete across namespaces with @+', async () => {
      const count = await router.delete('/@+/sensors/+', []);
      expect(count).toBe(3);
    });
  });

  // ── Data isolation ─────────────────────────────────────────────────────

  describe('isolation', () => {
    it('default namespace does not see named namespace data', async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5 });
      const rows = await router.query('/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(0);
    });

    it('named namespace does not see default namespace data', async () => {
      await router.upsert('/sensors/temp', { value: 23.5 });
      // fleet-a doesn't exist yet, so query returns empty
      // (it won't auto-create just for a query)
      const rows = await router.query('/@fleet-a/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(0);
    });

    it('named namespace does not see another namespace data', async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5 });
      const rows = await router.query('/@fleet-b/sensors/+', [], null, 'asc', 1e9, 0);
      expect(rows).toHaveLength(0);
    });
  });

  // ── Namespace listing ──────────────────────────────────────────────────

  describe('getNamespaces', () => {
    it('includes default (null) and named namespaces', async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5 });
      await router.upsert('/@warehouse/devices/pump', { status: 'on' });
      const nss = await router.getNamespaces();
      expect(nss).toContain(null);
      expect(nss).toContain('fleet-a');
      expect(nss).toContain('warehouse');
    });
  });

  // ── Persistence across namespaces ──────────────────────────────────────

  describe('persistence', () => {
    it('survives close and reconnect for multiple namespaces', async () => {
      await router.upsert('/@fleet-a/sensors/temp', { value: 23.5 });
      await router.upsert('/sensors/temp', { value: 18.0 });
      await router.close();

      const r2 = new Router();
      await r2.connect({ dataFile: path.join(tmpDir, 'data.json') });

      const r1 = await r2.getExact('/@fleet-a/sensors/temp');
      expect(r1.value).toBe(23.5);
      expect(r1._namespace).toBe('fleet-a');

      const r3 = await r2.getExact('/sensors/temp');
      expect(r3.value).toBe(18.0);

      await r2.close();
    });
  });

  // ── Error cases ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('rejects INSERT to wildcard namespace', async () => {
      await expect(
        router.upsert('/@+/sensors/temp', { value: 1 })
      ).rejects.toThrow(/wildcard namespace/i);
    });

    it('rejects INSERT to @# wildcard namespace', async () => {
      await expect(
        router.upsert('/@#', { value: 1 })
      ).rejects.toThrow(/wildcard namespace/i);
    });

    it('throws if not connected', async () => {
      const r2 = new Router();
      await expect(r2.query('/sensors/+', [], null, 'asc', 1e9, 0))
        .rejects.toThrow(/not connected/i);
    });
  });
});
