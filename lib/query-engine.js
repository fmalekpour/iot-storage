'use strict';

const { Parser } = require('node-sql-parser');

class QueryEngine {
  constructor(backend) {
    this.backend = backend;
    this.parser = new Parser();
  }

  /**
   * Execute a SQL string against the backend.
   * @param {string} sql — raw SQL
   * @returns {object} { rows, affected, type }
   */
  async execute(sql) {
    let ast;
    try {
      ast = this.parser.astify(sql);
    } catch (e) {
      throw new Error(`SQL parse error: ${e.message}`);
    }

    // Handle multiple statements (ast is an array)
    if (Array.isArray(ast)) {
      if (ast.length === 1) {
        ast = ast[0];
      } else {
        throw new Error('Multiple SQL statements are not supported');
      }
    }

    switch (ast.type.toLowerCase()) {
      case 'select':
        return await this._handleSelect(ast);
      case 'insert':
        return await this._handleInsert(ast);
      case 'update':
        return await this._handleUpdate(ast);
      case 'delete':
        return await this._handleDelete(ast);
      default:
        throw new Error(`Unsupported SQL statement type: ${ast.type}`);
    }
  }

  // ── SELECT ──────────────────────────────────────────────────────────────

  async _handleSelect(ast) {
    const table = this._extractTable(ast);
    const pathPattern = this._tableToPath(table);
    const filters = this._extractWhere(ast);
    const { sortBy, sortDir } = this._extractOrderBy(ast);
    const { limit, offset } = this._extractLimit(ast);
    const hasAggregation = this._hasAggregation(ast);
    const groupBy = this._extractGroupBy(ast);

    let rows = await this.backend.query(pathPattern, filters, sortBy, sortDir, Infinity, 0);

    if (hasAggregation) {
      rows = this._applyAggregation(ast, rows, groupBy);
    } else {
      // Apply column projection / aliases
      rows = this._projectColumns(ast, rows);

      // Apply limit/offset (for non-aggregated queries)
      if (offset > 0) {
        rows = rows.slice(offset);
      }
      if (limit !== Infinity) {
        rows = rows.slice(0, limit);
      }
    }

    return { type: 'select', rows, count: rows.length };
  }

  // ── INSERT ──────────────────────────────────────────────────────────────

  async _handleInsert(ast) {
    const table = this._extractTable(ast);
    const pathPattern = this._tableToPath(table);

    // No wildcards allowed for INSERT
    if (pathPattern.includes('+') || pathPattern.includes('#')) {
      throw new Error('Wildcards are not allowed in INSERT target paths');
    }

    const columns = ast.columns || [];
    const values = this._extractValues(ast);

    if (!values || values.length === 0) {
      throw new Error('No values provided for INSERT');
    }

    const insertedRows = [];

    for (const valueRow of values) {
      const data = {};
      if (columns.length > 0) {
        for (let i = 0; i < columns.length; i++) {
          if (i < valueRow.length) {
            data[columns[i]] = valueRow[i];
          }
        }
      } else {
        // INSERT without column list — store as _value if single value
        if (valueRow.length === 1) {
          data._value = valueRow[0];
        }
      }

      const record = await this.backend.upsert(pathPattern, data);
      insertedRows.push(record);
    }

    return {
      type: 'insert',
      rows: insertedRows,
      affected: insertedRows.length,
    };
  }

  // ── UPDATE ──────────────────────────────────────────────────────────────

  async _handleUpdate(ast) {
    const table = this._extractTable(ast);
    const pathPattern = this._tableToPath(table);
    const filters = this._extractWhere(ast);
    const updates = this._extractSet(ast);

    if (!updates || Object.keys(updates).length === 0) {
      throw new Error('No SET columns provided for UPDATE');
    }

    const affected = await this.backend.update(pathPattern, updates, filters);

    return { type: 'update', affected, rows: [] };
  }

  // ── DELETE ──────────────────────────────────────────────────────────────

  async _handleDelete(ast) {
    const table = this._extractTable(ast);
    const pathPattern = this._tableToPath(table);
    const filters = this._extractWhere(ast);

    const affected = await this.backend.delete(pathPattern, filters);

    return { type: 'delete', affected, rows: [] };
  }

  // ── Helpers: TABLE ──────────────────────────────────────────────────────

  _extractTable(ast) {
    if (!ast.from) {
      // For INSERT/UPDATE/DELETE, the table is at ast.table
      if (ast.table) {
        if (Array.isArray(ast.table)) return ast.table[0];
        return ast.table;
      }
      throw new Error('No table specified in query');
    }

    // For SELECT, table is in the FROM clause
    if (Array.isArray(ast.from)) {
      return ast.from[0];
    }
    return ast.from;
  }

  _tableToPath(tableObj) {
    if (!tableObj) throw new Error('No table in query');

    // tableObj can be { table, db, as } or a string
    let tableName;
    if (typeof tableObj === 'string') {
      tableName = tableObj;
    } else if (tableObj.table) {
      tableName = tableObj.table;
    } else if (tableObj.expr) {
      // Subquery — not supported
      throw new Error('Subqueries in FROM are not supported');
    } else {
      tableName = String(tableObj);
    }

    // Clean up quotes: the parser may leave quotes from identifiers
    tableName = tableName.replace(/^"|"$/g, '').replace(/^`|`$/g, '');

    // Ensure it starts with /
    if (!tableName.startsWith('/')) {
      tableName = '/' + tableName;
    }

    return tableName;
  }

  // ── Helpers: WHERE ──────────────────────────────────────────────────────

  _extractWhere(ast) {
    if (!ast.where) return [];
    return this._parseWhereClause(ast.where);
  }

  _parseWhereClause(whereNode) {
    if (!whereNode) return [];

    // Logical operators: AND, OR
    if (whereNode.type === 'binary_expr' && ['AND', 'OR'].includes(whereNode.operator)) {
      // For simplicity, only AND is fully supported; OR is flattened
      const left = this._parseWhereClause(whereNode.left);
      const right = this._parseWhereClause(whereNode.right);
      return [...left, ...right];
    }

    // Comparison operators
    if (whereNode.type === 'binary_expr') {
      const filter = this._parseComparison(whereNode);
      if (filter) return [filter];
    }

    // IS NULL / IS NOT NULL
    if (whereNode.type === 'binary_expr' && ['IS', 'IS NOT'].includes(whereNode.operator)) {
      return [this._parseIsNull(whereNode)];
    }

    // IN
    if (whereNode.type === 'in_expr' || (whereNode.type === 'binary_expr' && whereNode.operator === 'IN')) {
      return [this._parseInExpr(whereNode)];
    }

    // LIKE
    if (whereNode.type === 'binary_expr' && whereNode.operator === 'LIKE') {
      return [this._parseComparison(whereNode)];
    }

    // BETWEEN
    if (whereNode.type === 'binary_expr' && whereNode.operator === 'BETWEEN') {
      // BETWEEN is handled as >= AND <=
      const col = this._getColumnName(whereNode.left);
      const val1 = this._getValue(whereNode.right.left);
      const val2 = this._getValue(whereNode.right.right);
      return [
        { column: col, op: '>=', value: val1 },
        { column: col, op: '<=', value: val2 },
      ];
    }

    return [];
  }

  _parseComparison(node) {
    const column = this._getColumnName(node.left);
    const value = this._getValue(node.right);
    const op = node.operator;

    if (!column) return null;

    return { column, op, value };
  }

  _parseIsNull(node) {
    const column = this._getColumnName(node.left);
    const isNull = node.right && node.right.value === null;
    return {
      column,
      op: node.operator, // 'IS' or 'IS NOT'
      value: null,
    };
  }

  _parseInExpr(node) {
    const column = this._getColumnName(node.left || node.expr);
    let values = [];

    if (node.right && node.right.type === 'expr_list') {
      values = node.right.value.map(v => this._getValue(v));
    } else if (node.values) {
      values = node.values.map(v => this._getValue(v));
    }

    return { column, op: 'IN', value: values };
  }

  _getColumnName(node) {
    if (!node) return null;

    if (node.type === 'column_ref') {
      return node.column;
    }

    if (node.type === 'number' || node.type === 'single_quote_string' || node.type === 'string') {
      // Comparing literal to column — check if the right side is the column
      // For simple cases, return null (let _getValue handle it)
      return null;
    }

    return null;
  }

  _getValue(node) {
    if (!node) return null;

    switch (node.type) {
      case 'number': {
        const val = node.value;
        // node-sql-parser stores numbers as strings; parse properly
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? val : num;
        }
        return val;
      }
      case 'single_quote_string':
      case 'double_quote_string':
      case 'string':
        return node.value;
      case 'null':
        return null;
      case 'bool':
        return node.value;
      case 'column_ref':
        return node.column;
      case 'expr_list':
        return node.value.map(v => this._getValue(v));
      default:
        return null;
    }
  }

  // ── Helpers: ORDER BY ───────────────────────────────────────────────────

  _extractOrderBy(ast) {
    if (!ast.orderby || ast.orderby.length === 0) {
      return { sortBy: null, sortDir: 'asc' };
    }

    const first = ast.orderby[0];
    const sortBy = this._getColumnName(first.expr) || first.expr?.column;
    const sortDir = first.type === 'DESC' ? 'desc' : 'asc';

    return { sortBy, sortDir };
  }

  // ── Helpers: LIMIT ──────────────────────────────────────────────────────

  _extractLimit(ast) {
    let limit = Infinity;
    let offset = 0;

    if (ast.limit) {
      const limitObj = ast.limit;

      // node-sql-parser v5: limit is { seperator, value: [...] }
      if (limitObj.value && Array.isArray(limitObj.value)) {
        if (limitObj.seperator === 'offset') {
          // LIMIT ... OFFSET ... — two values in the array
          limit = limitObj.value[0]?.value ?? Infinity;
          offset = limitObj.value[1]?.value ?? 0;
        } else {
          // Just LIMIT — single value
          limit = limitObj.value[0]?.value ?? Infinity;
        }
      } else if (limitObj.value && typeof limitObj.value === 'number') {
        limit = limitObj.value;
      }
    }

    return { limit, offset };
  }

  // ── Helpers: GROUP BY ───────────────────────────────────────────────────

  _extractGroupBy(ast) {
    if (!ast.groupby) return [];

    // node-sql-parser v5: groupby is { columns: [...], modifiers: [...] }
    let columns = [];
    if (Array.isArray(ast.groupby.columns)) {
      columns = ast.groupby.columns;
    } else if (Array.isArray(ast.groupby)) {
      columns = ast.groupby;
    }

    return columns.map(g => {
      if (g.type === 'column_ref') return g.column;
      if (g.expr) return g.expr.column || g.expr.value;
      return null;
    }).filter(Boolean);
  }

  // ── Helpers: SET (for UPDATE) ───────────────────────────────────────────

  _extractSet(ast) {
    const updates = {};
    if (!ast.set) return updates;

    for (const s of ast.set) {
      const col = s.column;
      const val = this._getValue(s.value);
      updates[col] = val;
    }

    return updates;
  }

  // ── Helpers: VALUES (for INSERT) ────────────────────────────────────────

  _extractValues(ast) {
    if (!ast.values) return [];

    if (ast.values.type === 'values') {
      return ast.values.values.map(row =>
        row.value.map(v => this._getValue(v))
      );
    }

    // SELECT ... INSERT — not supported
    throw new Error('INSERT ... SELECT is not supported');
  }

  // ── Helpers: Aggregations ───────────────────────────────────────────────

  _hasAggregation(ast) {
    if (!ast.columns) return false;

    // node-sql-parser v5: columns is an array of objects with expr property
    const checkNode = (node) => {
      if (!node) return false;
      if (node.type === 'aggr_func') return true;
      if (node.expr) return checkNode(node.expr);
      if (node.args) {
        return node.args.some(arg => checkNode(arg));
      }
      return false;
    };

    return ast.columns.some(col => checkNode(col.expr || col));
  }

  _applyAggregation(ast, rows, groupByColumns) {
    if (rows.length === 0) {
      // Need to handle empty result set with aggregation
      return this._emptyAggregationResult(ast);
    }

    const groups = new Map();

    if (groupByColumns.length > 0) {
      // Group rows by the specified columns
      for (const row of rows) {
        const key = groupByColumns.map(c => String(row[c] ?? 'null')).join('|');
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(row);
      }
    } else {
      // No GROUP BY — aggregate all rows into a single group
      groups.set('__all__', rows);
    }

    const resultRows = [];

    for (const [groupKey, groupRows] of groups) {
      const resultRow = {};

      // Add group-by columns to result
      if (groupByColumns.length > 0) {
        for (const col of groupByColumns) {
          resultRow[col] = groupRows[0][col];
        }
      }

      // Apply each aggregation function
      for (const col of ast.columns) {
        this._applyAggregateToRow(col, groupRows, resultRow);
      }

      resultRows.push(resultRow);
    }

    return resultRows;
  }

  _applyAggregateToRow(col, rows, resultRow) {
    const expr = col.expr || col;
    const alias = col.as || null;

    if (expr.type === 'aggr_func') {
      const funcName = expr.name.toUpperCase();
      const args = expr.args;

      let targetColumn = '*';
      if (args && args.expr) {
        if (args.expr.type === 'column_ref') {
          targetColumn = args.expr.column;
        } else if (args.expr.type === 'star') {
          targetColumn = '*';
        }
      }

      const key = alias || `${funcName}(${targetColumn})`;

      switch (funcName) {
        case 'COUNT':
          if (targetColumn === '*') {
            resultRow[key] = rows.length;
          } else {
            resultRow[key] = rows.filter(r => r[targetColumn] != null).length;
          }
          break;

        case 'SUM': {
          const vals = rows.map(r => Number(r[targetColumn])).filter(v => !isNaN(v));
          resultRow[key] = vals.reduce((a, b) => a + b, 0);
          break;
        }

        case 'AVG': {
          const vals = rows.map(r => Number(r[targetColumn])).filter(v => !isNaN(v));
          resultRow[key] = vals.length > 0
            ? vals.reduce((a, b) => a + b, 0) / vals.length
            : null;
          break;
        }

        case 'MIN': {
          const vals = rows.map(r => r[targetColumn]).filter(v => v != null);
          resultRow[key] = vals.length > 0
            ? vals.reduce((a, b) => (a < b ? a : b))
            : null;
          break;
        }

        case 'MAX': {
          const vals = rows.map(r => r[targetColumn]).filter(v => v != null);
          resultRow[key] = vals.length > 0
            ? vals.reduce((a, b) => (a > b ? a : b))
            : null;
          break;
        }

        default:
          resultRow[key] = null;
      }
    } else if (expr.type === 'column_ref') {
      // Non-aggregated column
      const key = alias || expr.column;
      if (rows.length > 0) {
        resultRow[key] = rows[0][expr.column];
      }
    } else if (expr.type === 'star') {
      // SELECT * with aggregation — not typical, but include first row's data
      if (rows.length > 0) {
        Object.assign(resultRow, rows[0]);
      }
    }
  }

  _emptyAggregationResult(ast) {
    const result = {};

    for (const col of ast.columns) {
      const expr = col.expr || col;
      const alias = col.as || null;

      if (expr.type === 'aggr_func') {
        const funcName = expr.name.toUpperCase();
        const args = expr.args;
        let targetColumn = '*';
        if (args && args.expr) {
          if (args.expr.type === 'column_ref') {
            targetColumn = args.expr.column;
          } else if (args.expr.type === 'star') {
            targetColumn = '*';
          }
        }
        const key = alias || `${funcName}(${targetColumn})`;
        result[key] = funcName === 'COUNT' ? 0 : null;
      }
    }

    return [result];
  }

  // ── Helpers: Column Projection ──────────────────────────────────────────

  _projectColumns(ast, rows) {
    if (!ast.columns || ast.columns.length === 0) {
      return rows;
    }

    // Check for SELECT *
    const isStar = ast.columns.some(c => {
      const expr = c.expr || c;
      return expr.type === 'star' || (expr.type === 'column_ref' && expr.column === '*');
    });

    if (isStar || ast.columns[0]?.expr?.type === 'column_ref' && ast.columns[0]?.expr?.column === '*') {
      return rows;
    }

    return rows.map(row => {
      const projected = {};
      for (const col of ast.columns) {
        const expr = col.expr || col;
        const alias = col.as || null;

        if (expr.type === 'column_ref') {
          const key = alias || expr.column;
          projected[key] = row[expr.column];
        }
      }
      return projected;
    });
  }
}

module.exports = QueryEngine;
