'use strict';

const path = require('path');
const os = require('fs');
const fs = require('fs');
const JsonBackend = require('../lib/backends/json');
const QueryEngine = require('../lib/query-engine');

describe('Query Engine', () => {
  let engine;
  let backend;
  let tmpFile;

  beforeEach(async () => {
    tmpFile = path.join(require('os').tmpdir(), `iot-storage-qe-${Date.now()}.json`);
    backend = new JsonBackend();
    await backend.connect({ dataFile: tmpFile });
    engine = new QueryEngine(backend);
  });

  afterEach(async () => {
    await backend.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  describe('INSERT', () => {
    it('inserts a single row', async () => {
      const result = await engine.execute(
        `INSERT INTO "/test/a" (name, value) VALUES ('hello', 42)`
      );
      expect(result.type).toBe('insert');
      expect(result.affected).toBe(1);
      expect(result.rows[0].name).toBe('hello');
      expect(result.rows[0].value).toBe(42);
      expect(result.rows[0]._path).toBe('/test/a');
    });

    it('inserts without column list', async () => {
      const result = await engine.execute(
        `INSERT INTO "/test/b" VALUES (99)`
      );
      expect(result.affected).toBe(1);
      expect(result.rows[0]._value).toBe(99);
    });

    it('rejects wildcards in INSERT', async () => {
      await expect(
        engine.execute(`INSERT INTO "/sensors/+" (val) VALUES (1)`)
      ).rejects.toThrow(/wildcards/i);
    });
  });

  describe('SELECT', () => {
    beforeEach(async () => {
      await engine.execute(`INSERT INTO "/sensors/temp" (value, unit) VALUES (23.5, 'C')`);
      await engine.execute(`INSERT INTO "/sensors/humidity" (value, unit) VALUES (65, '%')`);
      await engine.execute(`INSERT INTO "/sensors/room1/light" (value, unit) VALUES (1, 'bool')`);
    });

    it('selects by exact path', async () => {
      const result = await engine.execute(`SELECT * FROM "/sensors/temp"`);
      expect(result.rows.length).toBe(1);
    });

    it('selects parent path returning all children', async () => {
      const result = await engine.execute(`SELECT * FROM "/sensors"`);
      expect(result.rows.length).toBe(3);
    });

    it('selects with + wildcard', async () => {
      const result = await engine.execute(`SELECT * FROM "/sensors/+"`);
      // + matches temp and humidity but not room1/light
      expect(result.rows.length).toBe(2);
    });

    it('selects with # wildcard', async () => {
      const result = await engine.execute(`SELECT * FROM "/sensors/#"`);
      expect(result.rows.length).toBe(3);
    });

    it('filters with WHERE', async () => {
      const result = await engine.execute(
        `SELECT * FROM "/sensors/+" WHERE value > 50`
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]._path).toBe('/sensors/humidity');
    });

    it('orders by column', async () => {
      const result = await engine.execute(
        `SELECT * FROM "/sensors/+" ORDER BY value ASC`
      );
      expect(result.rows[0].value).toBeLessThan(result.rows[1].value);
    });

    it('applies LIMIT', async () => {
      const result = await engine.execute(
        `SELECT * FROM "/sensors/#" LIMIT 2`
      );
      expect(result.rows.length).toBe(2);
    });

    it('projects columns', async () => {
      const result = await engine.execute(
        `SELECT value, unit FROM "/sensors/temp"`
      );
      expect(result.rows[0]).toHaveProperty('value');
      expect(result.rows[0]).toHaveProperty('unit');
      expect(result.rows[0]).not.toHaveProperty('_path');
    });
  });

  describe('UPDATE', () => {
    beforeEach(async () => {
      await engine.execute(`INSERT INTO "/dev/a" (status, val) VALUES ('on', 10)`);
      await engine.execute(`INSERT INTO "/dev/b" (status, val) VALUES ('off', 20)`);
    });

    it('updates matching paths', async () => {
      const result = await engine.execute(
        `UPDATE "/dev/+" SET status = 'reset'`
      );
      expect(result.affected).toBe(2);
    });
  });

  describe('DELETE', () => {
    beforeEach(async () => {
      await engine.execute(`INSERT INTO "/tmp/x" (data) VALUES (1)`);
      await engine.execute(`INSERT INTO "/tmp/y" (data) VALUES (2)`);
    });

    it('deletes matching paths', async () => {
      const result = await engine.execute(`DELETE FROM "/tmp/x"`);
      expect(result.affected).toBe(1);
    });

    it('deletes with wildcard', async () => {
      const result = await engine.execute(`DELETE FROM "/tmp/+"`);
      expect(result.affected).toBe(2);
    });
  });

  describe('Aggregations', () => {
    beforeEach(async () => {
      await engine.execute(`INSERT INTO "/metrics/a" (val, cat) VALUES (10, 'x')`);
      await engine.execute(`INSERT INTO "/metrics/b" (val, cat) VALUES (20, 'x')`);
      await engine.execute(`INSERT INTO "/metrics/c" (val, cat) VALUES (30, 'y')`);
    });

    it('COUNT(*)', async () => {
      const result = await engine.execute(`SELECT COUNT(*) FROM "/metrics/+"`);
      expect(result.rows[0]['COUNT(*)']).toBe(3);
    });

    it('AVG', async () => {
      const result = await engine.execute(`SELECT AVG(val) FROM "/metrics/+"`);
      expect(result.rows[0]['AVG(val)']).toBe(20);
    });

    it('SUM', async () => {
      const result = await engine.execute(`SELECT SUM(val) FROM "/metrics/+"`);
      expect(result.rows[0]['SUM(val)']).toBe(60);
    });

    it('GROUP BY', async () => {
      const result = await engine.execute(
        `SELECT cat, COUNT(*) AS cnt FROM "/metrics/+" GROUP BY cat`
      );
      expect(result.rows.length).toBe(2);
      const xRow = result.rows.find(r => r.cat === 'x');
      expect(xRow.cnt).toBe(2);
    });
  });

  describe('Error handling', () => {
    it('throws on invalid SQL', async () => {
      await expect(engine.execute('GARBAGE SQL')).rejects.toThrow();
    });

    it('throws on unsupported statement type', async () => {
      await expect(engine.execute('CREATE TABLE foo (id INT)')).rejects.toThrow();
    });
  });
});
