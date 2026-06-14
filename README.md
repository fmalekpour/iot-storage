# iot-storage

**Path-based lightweight SQL database with REST API — MQTT-inspired hierarchical records.**

Think of it as MQTT topics meets SQL. Every path is a record. Query with SQL. Built for IoT and edge deployments.

---

## Install

```bash
npm install -g iot-storage
```

## Quick Start

```bash
# Start as a daemon (background)
iot-storage start

# Or run in foreground (debug mode)
iot-storage run
```

By default, iot-storage listens on `http://localhost:9123` and stores data in `~/.iot-storage/data.json`.

## CLI Commands

| Command | Description |
|---------|-------------|
| `iot-storage start` | Start as background daemon |
| `iot-storage stop` | Stop the daemon |
| `iot-storage restart` | Restart the daemon |
| `iot-storage run` | Run in foreground (debug mode) |
| `iot-storage status` | Check if daemon is running |

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <number>` | Server port | `9123` |
| `-d, --data <path>` | JSON data file path | `~/.iot-storage/data.json` |
| `-b, --backend <name>` | Storage backend | `json` |
| `-c, --config <path>` | Config file | — |

---

## API Reference

All data is sent and received as JSON.

### `POST /query` — Execute SQL

```bash
curl -X POST http://localhost:9123/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "INSERT INTO \"/sensors/temp\" (value, unit) VALUES (23.5, \"C\")"}'
```

Response:
```json
{
  "type": "insert",
  "rows": [
    {
      "_path": "/sensors/temp",
      "value": 23.5,
      "unit": "C",
      "_created": "2026-06-13T10:00:00.000Z",
      "_updated": "2026-06-13T10:00:00.000Z"
    }
  ],
  "affected": 1
}
```

### Path-Based Data Access

For simple operations without SQL:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/data/:path` | Fetch record(s) at path |
| `PUT` | `/data/:path` | Upsert record at path |
| `DELETE` | `/data/:path` | Delete record(s) at path |

```bash
# Fetch all sensor records
curl http://localhost:9123/data/sensors/+

# Upsert a record
curl -X PUT http://localhost:9123/data/sensors/humidity \
  -H "Content-Type: application/json" \
  -d '{"value": 65, "unit": "%"}'

# Delete a record
curl -X DELETE http://localhost:9123/data/sensors/temp
```

### `GET /health`

```bash
curl http://localhost:9123/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 3600,
  "backend": "json",
  "version": "1.0.0"
}
```

---

## SQL Reference

### INSERT

```sql
INSERT INTO "/sensors/temp" (value, unit) VALUES (23.5, 'C')
INSERT INTO "/sensors/temp" (value, unit) VALUES (24.1, 'C'), (22.8, 'C')
```

### SELECT

```sql
-- Exact path
SELECT * FROM "/sensors/temp"

-- Single-level wildcard (+)
SELECT * FROM "/sensors/+"

-- Multi-level wildcard (#) — at end of path only
SELECT * FROM "/sensors/#"

-- With WHERE filters
SELECT * FROM "/sensors/+" WHERE value > 20 AND unit = 'C'

-- With sorting
SELECT * FROM "/sensors/+" ORDER BY value DESC

-- With limit
SELECT * FROM "/sensors/+" LIMIT 10

-- Column projection
SELECT value, unit FROM "/sensors/temp"
```

### UPDATE

```sql
UPDATE "/sensors/temp" SET unit = 'F', value = 75.2
UPDATE "/sensors/+" SET status = 'inactive' WHERE value < 0
```

### DELETE

```sql
DELETE FROM "/sensors/temp"
DELETE FROM "/sensors/+" WHERE value IS NULL
```

### Aggregations

```sql
SELECT COUNT(*) FROM "/sensors/+"
SELECT AVG(value) FROM "/sensors/temp"
SELECT SUM(value) FROM "/sensors/+"
SELECT MIN(value), MAX(value) FROM "/sensors/+"
SELECT unit, AVG(value) AS avg_val FROM "/sensors/+" GROUP BY unit
```

### WHERE Operators

| Operator | Description |
|----------|-------------|
| `=`, `==` | Equal |
| `!=`, `<>` | Not equal |
| `>`, `<` | Greater / Less than |
| `>=`, `<=` | Greater / Less or equal |
| `LIKE` | Pattern match (`%` = any, `_` = single char) |
| `IN` | Value in list |
| `IS NULL` | Value is null |
| `IS NOT NULL` | Value is not null |

---

## Path System (MQTT-Inspired)

Paths work like MQTT topics:

| Pattern | Matches |
|---------|---------|
| `/sensors/temp` | Exactly `/sensors/temp` |
| `/sensors/+` | `/sensors/temp`, `/sensors/humidity` (single level) |
| `/sensors/#` | `/sensors/temp`, `/sensors/room/light` (all levels) |

> **Important**: When you SELECT a parent path like `/sensors`, it returns the record at `/sensors` AND all its descendants. This is analogous to MQTT where subscribing to `/sensors` gives you all messages under that topic.

---

## Configuration

iot-storage reads configuration from (in priority order):

1. **CLI flags** — `iot-storage run --port 8080 --data ./mydata.json`
2. **Local config** — `./iot-storage.config.json` (in current directory)
3. **Home config** — `~/.iot-storage/config.json`
4. **Environment** — `IOT_STORAGE_PORT=8080`, `IOT_STORAGE_DATA_FILE=./mydata.json`
5. **Defaults** — port `9123`, data `~/.iot-storage/data.json`

Example config file:
```json
{
  "port": 8080,
  "dataFile": "/var/lib/iot-storage/data.json",
  "backend": "json"
}
```

---

## Backend Plugins

iot-storage supports pluggable backends. Currently `json` is the only built-in backend. To create a custom backend, extend the `Backend` base class:

```js
const { backends } = require('iot-storage');

class MyBackend extends backends.Base {
  async connect(config) { /* ... */ }
  async upsert(path, data) { /* ... */ }
  async query(pathPattern, filters, sortBy, sortDir, limit, offset) { /* ... */ }
  async update(pathPattern, updates, filters) { /* ... */ }
  async delete(pathPattern, filters) { /* ... */ }
  async getExact(path) { /* ... */ }
  async close() { /* ... */ }
}
```

---

## Data Directory

```
~/.iot-storage/
├── iot-storage.pid        # Daemon PID file
├── config.json      # User configuration
├── data.json        # JSON data storage
└── logs/
    └── iot-storage.log    # Daemon stdout/stderr logs
```

---

## License

MIT © iot-storage contributors
