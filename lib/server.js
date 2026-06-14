'use strict';

const express = require('express');
const Config = require('./config');
const JsonBackend = require('./backends/json');
const QueryEngine = require('./query-engine');

// ── Initialize config ────────────────────────────────────────────────────
const config = new Config();
config.load();

const PORT = config.get('port');
const DATA_FILE = config.get('dataFile');
const BACKEND_NAME = config.get('backend');

// ── Initialize backend ───────────────────────────────────────────────────
let backend;

switch (BACKEND_NAME) {
  case 'json':
  default:
    backend = new JsonBackend();
    break;
}

// ── Initialize query engine ──────────────────────────────────────────────
const engine = new QueryEngine(backend);

// ── Create Express app ───────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Startup time ─────────────────────────────────────────────────────────
const startTime = Date.now();

// ── POST /query ──────────────────────────────────────────────────────────
app.post('/query', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({
        error: 'Request body must contain a "sql" string field',
      });
    }

    const result = await engine.execute(sql.trim());

    res.json(result);
  } catch (e) {
    res.status(400).json({
      error: e.message,
    });
  }
});

// ── GET /data/:path(*) ───────────────────────────────────────────────────
app.get('/data/*', async (req, res) => {
  try {
    const recordPath = '/' + (req.params[0] || '');

    // Use query to support wildcards and parent-path expansion
    const rows = await backend.query(recordPath, [], null, 'asc', Infinity, 0);

    if (rows.length === 0) {
      return res.status(404).json({ error: `No records found for path: ${recordPath}` });
    }

    // If exact match has only one result, return the record directly
    if (rows.length === 1 && rows[0]._path === recordPath) {
      return res.json(rows[0]);
    }

    res.json({ rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── PUT /data/:path(*) ───────────────────────────────────────────────────
app.put('/data/*', async (req, res) => {
  try {
    const recordPath = '/' + (req.params[0] || '');

    if (recordPath.includes('+') || recordPath.includes('#')) {
      return res.status(400).json({ error: 'Wildcards not allowed in PUT path' });
    }

    const data = req.body || {};
    const record = await backend.upsert(recordPath, data);

    res.json(record);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── DELETE /data/:path(*) ────────────────────────────────────────────────
app.delete('/data/*', async (req, res) => {
  try {
    const recordPath = '/' + (req.params[0] || '');

    const affected = await backend.delete(recordPath, []);

    res.json({ affected });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── GET /health ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    backend: BACKEND_NAME,
    version: require('../package.json').version,
  });
});

// ── Root info ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'iot-storage',
    version: require('../package.json').version,
    endpoints: {
      'POST /query': 'Execute SQL queries',
      'GET /data/:path': 'Fetch records by path',
      'PUT /data/:path': 'Upsert a record at path',
      'DELETE /data/:path': 'Delete records at path',
      'GET /health': 'Health check',
    },
    docs: 'https://github.com/fmalekpour/iot-storage',
  });
});

// ── 404 handler ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ── Start server ─────────────────────────────────────────────────────────
async function start() {
  await backend.connect({ dataFile: DATA_FILE });

  const server = app.listen(PORT, () => {
    console.log(`[iot-storage] Server running on http://localhost:${PORT}`);
    console.log(`[iot-storage] Backend: ${BACKEND_NAME}`);
    console.log(`[iot-storage] Data file: ${DATA_FILE}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[iot-storage] Received ${signal}, shutting down...`);
    server.close(async () => {
      await backend.close();
      console.log('[iot-storage] Server stopped');
      process.exit(0);
    });

    // Force exit after 5 seconds
    setTimeout(() => {
      console.error('[iot-storage] Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((e) => {
  console.error(`[iot-storage] Failed to start: ${e.message}`);
  process.exit(1);
});
