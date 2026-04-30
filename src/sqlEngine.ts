import type { DatabaseState, QueryResult, Column } from './types';

const STORAGE_KEY = 'sql_emulator_data';

export function loadState(): DatabaseState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
  return {
    databases: {},
    currentDatabase: null,
  };
}

export function saveState(state: DatabaseState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

export function resetDatabase(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function parseColumnDefinition(def: string): Column | null {
  const simpleMatch = def.match(/^(\w+)\s+(\w+)(\(\d+\))?/i);
  if (!simpleMatch) return null;
  const rawType = simpleMatch[2].toUpperCase();
  let type: Column['type'] = rawType === 'INTEGER' ? 'INT' : rawType === 'INT' ? 'INT' : rawType === 'VARCHAR' ? 'VARCHAR' : rawType === 'TEXT' ? 'TEXT' : rawType === 'DATE' ? 'DATE' : rawType === 'BOOLEAN' ? 'BOOLEAN' : rawType === 'FLOAT' ? 'FLOAT' : rawType === 'DOUBLE' ? 'DOUBLE' : 'VARCHAR';
  return {  
    name: simpleMatch[1],  
    type,
    primaryKey: /PRIMARY\s+KEY/i.test(def),  
    nullable: !/NOT\s+NULL/i.test(def)
  };
}

function parseCreateTable(sql: string): { tableName: string; columns: Column[] } | null {
  const match = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\((.+)\)/i);
  if (!match) return null;
  const tableName = match[1];
  const columnsStr = match[2];
  const columnDefs = columnsStr.split(',').map(c => c.trim()).filter(c => c);
  const columns: Column[] = [];
  for (const colDef of columnDefs) {
    if (/^\w+\s+\w+/i.test(colDef)) {
      const col = parseColumnDefinition(colDef);
      if (col) columns.push(col);
    }
  }
  return { tableName, columns };
}

function parseInsert(sql: string): { tableName: string; columns: string[]; values: unknown[][] } | null {
  const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*(?:\(([^)]+)\))?\s+VALUES\s*(.+)$/i);
  if (!match) return null;
  const tableName = match[1];
  const columns = match[2] ? match[2].split(',').map(c => c.trim()) : [];
  const valuesStr = match[3];
  const valueSets = valuesStr.split(/\),\s*/).map(v => v.replace(/[()]/g, '').trim());
  const values: unknown[][] = [];
  for (const valueSet of valueSets) {
    const vals = valueSet.split(',').map(v => {
      v = v.trim();
      if (v === 'NULL') return null;
      if (v === 'TRUE') return true;
      if (v === 'FALSE') return false;
      const numMatch = v.match(/^(-?\d+\.?\d*)$/);
      if (numMatch) return Number(numMatch[1]);
      const strMatch = v.match(/^'(.*)'$/);
      if (strMatch) return strMatch[1].replace(/''/g, "'");
      return v;
    });
    values. push(vals);
  }
  return { tableName, columns, values };
}

function parseSelect(sql: string): { 
  columns: string | string[]; 
  table: string; 
  where?: string; 
  groupBy?: string[]; 
  having?: string;
  orderBy?: string[];
  orderDesc?: boolean[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
} | null {
  const selectMatch = sql.match(/SELECT\s+(DISTINCT\s+)?(.+?)\s+FROM\s+(\w+)/i);
  if (!selectMatch) return null;
  
  const distinct = !!(selectMatch[1]);
  const columnsStr = selectMatch[2];
  const table = selectMatch[3];
  const afterFrom = sql.substring(selectMatch[0].length);
  
  let where: string | undefined;
  let groupBy: string[] | undefined;
  let having: string | undefined;
  let orderBy: string[] | undefined;
  let orderDesc: boolean[] | undefined;
  let limit: number | undefined;
  let offset: number | undefined;
  
  const havingMatch = afterFrom.match(/\s+HAVING\s+(.+?)(?=\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
  if (havingMatch) {
    having = havingMatch[1].trim();
  }
  
  const orderMatch = afterFrom.match(/\s+ORDER\s+BY\s+(.+?)(?=\s+LIMIT|\s*$)/i);
  if (orderMatch) {
    const orderParts = orderMatch[1].split(',').map(p => p.trim());
    orderBy = orderParts.map(p => p.replace(/\s+ASC\s*$/i, '').replace(/\s+DESC\s*$/i, '').trim());
    orderDesc = orderParts.map(p => /\s+DESC\s*$/i.test(p));
  }
  
  const limitMatch = afterFrom.match(/\s+LIMIT\s+(\d+)/i);
  if (limitMatch) {
    limit = parseInt(limitMatch[1]);
  }
  
  const offsetMatch = afterFrom.match(/\s+OFFSET\s+(\d+)/i);
  if (offsetMatch) {
    offset = parseInt(offsetMatch[1]);
  }
  
  const groupMatch = afterFrom.match(/\s+GROUP\s+BY\s+(.+?)(?=\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
  if (groupMatch) {
    groupBy = groupMatch[1].split(',').map(c => c.trim());
  }
  
  const whereMatch = afterFrom.match(/\s+WHERE\s+(.+?)(?=\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
  if (whereMatch) {
    where = whereMatch[1].trim();
  }
  
  const columns = columnsStr === '*' ? '*' : columnsStr.split(',').map(c => c.trim());
  
  return { columns, table, where, groupBy, having, orderBy, orderDesc, limit, offset, distinct };
}

function parseUpdate(sql: string): { table: string; set: Record<string, unknown>; where?: string } | null {
  const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;
  const table = match[1];
  const setPairs = match[2].split(',').map(s => s.trim());
  const set: Record<string, unknown> = {};
  for (const pair of setPairs) {
    const [col, val] = pair.split('=').map(s => s.trim());
    let value: unknown = val;
    if (val === 'NULL') value = null;
    else if (val === 'TRUE') value = true;
    else if (val === 'FALSE') value = false;
    else if (/^-?\d+\.?\d*$/.test(val)) value = Number(val);
    else if (/^'(.*)'$/.test(val)) value = val.slice(1, -1);
    set[col] = value;
  }
  const where = match[3];
  return { table, set, where };
}

function parseDelete(sql: string): { table: string; where?: string } | null {
  const match = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;
  return { table: match[1], where: match[2] };
}

function matchRow(row: Record<string, unknown>, where?: string): boolean {
  if (!where) return true;
  try {
    // Normalize row to lowercase keys for case-insensitive matching
    const normalizedRow: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      normalizedRow[key.toLowerCase()] = row[key];
    }
    
    // Build JS expression from SQL WHERE clause
    let condition = where;
    
    // Process tokens from right to left to avoid partial replacements
    // Handle NOT BETWEEN
    condition = condition.replace(/(\w+)\s+NOT\s+BETWEEN\s+(\d+\.?\d*)\s+AND\s+(\d+\.?\d*)/gi, 
      (_, col, val1, val2) => `!(row['${col.toLowerCase()}'] >= ${val1} && row['${col.toLowerCase()}'] <= ${val2})`);
    
    // Handle BETWEEN
    condition = condition.replace(/(\w+)\s+BETWEEN\s+(\d+\.?\d*)\s+AND\s+(\d+\.?\d*)/gi,
      (_, col, val1, val2) => `(row['${col.toLowerCase()}'] >= ${val1} && row['${col.toLowerCase()}'] <= ${val2})`);
    
    // Handle NOT IN
    condition = condition.replace(/(\w+)\s+NOT\s+IN\s*\(([^)]+)\)/gi, (_, col, vals) => {
      const checks = vals.split(',').map((v: string) => {
        const trimmed = v.trim();
        if (/^-?\d+\.?\d*$/.test(trimmed)) {
          return `row['${col.toLowerCase()}'] === ${trimmed}`;
        }
        const strMatch = trimmed.match(/^'(.*)'$/);
        if (strMatch) {
          const inner = strMatch[1].replace(/''/g, "'");
          return `row['${col.toLowerCase()}'] === '${inner.replace(/'/g, "\\'")}'`;
        }
        return `row['${col.toLowerCase()}'] === '${trimmed.replace(/'/g, "\\'")}'`;
      });
      return `!(${checks.join(' || ')})`;
    });
    
    // Handle IN
    condition = condition.replace(/(\w+)\s+IN\s*\(([^)]+)\)/gi, (_, col, vals) => {
      const checks = vals.split(',').map((v: string) => {
        const trimmed = v.trim();
        if (/^-?\d+\.?\d*$/.test(trimmed)) {
          return `row['${col.toLowerCase()}'] === ${trimmed}`;
        }
        const strMatch = trimmed.match(/^'(.*)'$/);
        if (strMatch) {
          const inner = strMatch[1].replace(/''/g, "'");
          return `row['${col.toLowerCase()}'] === '${inner.replace(/'/g, "\\'")}'`;
        }
        return `row['${col.toLowerCase()}'] === '${trimmed.replace(/'/g, "\\'")}'`;
      });
      return `(${checks.join(' || ')})`;
    });
    
    // Handle IS NOT NULL
    condition = condition.replace(/(\w+)\s+IS\s+NOT\s+NULL/gi, 
      (_, col) => `row['${col.toLowerCase()}'] !== null && row['${col.toLowerCase()}'] !== undefined`);
    
    // Handle IS NULL
    condition = condition.replace(/(\w+)\s+IS\s+NULL/gi, 
      (_, col) => `row['${col.toLowerCase()}'] === null || row['${col.toLowerCase()}'] === undefined`);
    
    // Handle NOT LIKE
    condition = condition.replace(/(\w+)\s+NOT\s+LIKE\s+'([^']*)'/gi, (_, col, pattern) => {
      const regexPattern = pattern.replace(/%/g, '.*').replace(/_/g, '.');
      return `!(/^${regexPattern}$/i.test(String(row['${col.toLowerCase()}'] || '')))`;
    });
    
    // Handle LIKE
    condition = condition.replace(/(\w+)\s+LIKE\s+'([^']*)'/gi, (_, col, pattern) => {
      const regexPattern = pattern.replace(/%/g, '.*').replace(/_/g, '.');
      return `/(^${regexPattern}$)/i.test(String(row['${col.toLowerCase()}'] || ''))`;
    });
    
    // Handle operators: replace column names with row['col'] and SQL ops with JS ops
    condition = condition.replace(/(\w+)\s*(=|!=|<>|<|>|>=|<=)\s*('[^']*'|\d+\.?\d*|\w+)/gi, (_, col, op, val) => {
      let v = val.trim();
      if (/^'/.test(v)) {
        v = "'" + v.slice(1, -1).replace(/'/g, "\\'") + "'";
      }
      const jsOp = op === '=' ? '===' : op === '!=' || op === '<>' ? '!==' : op;
      return `row['${col.toLowerCase()}'] ${jsOp} ${v}`;
    });
    
    // Replace AND/OR with JS operators
    condition = condition.replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||');
    
    const func = new Function("row", "return " + condition);
    return func(normalizedRow);
  } catch (e) {
    console.error('matchRow error:', e, 'where:', where);
    return false;
  }
}

type AggregateFunc = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

interface AggregateExpr {
  func: AggregateFunc;
  column: string;
  alias?: string;
}

function parseAggregateExpr(expr: string): AggregateExpr | null {
  const upper = expr.toUpperCase();
  const aggFuncs = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
  
  let func: AggregateFunc | null = null;
  for (const f of aggFuncs) {
    if (upper.startsWith(f)) {
      func = f as AggregateFunc;
      break;
    }
  }
  
  if (!func) return null;
  
  const rest = expr.substring(func.length).trim();
  if (!rest.startsWith('(')) return null;
  
  const closeIdx = rest.indexOf(')');
  if (closeIdx === -1) return null;
  
  const inner = rest.substring(1, closeIdx).trim();
  const column = inner === '*' ? '*' : inner;
  
  // Check for alias in original expr
  const afterParen = expr.substring(expr.indexOf(')') + 1).trim();
  let alias: string | undefined;
  const aliasMatch = afterParen.match(/^AS\s+(\w+)$/i);
  if (aliasMatch) alias = aliasMatch[1];
  
  return { func, column, alias };
}

function computeAggregate(func: AggregateFunc, rows: Record<string, unknown>[], col: string): unknown {
  switch (func) {
    case 'COUNT':
      if (col === '*') return rows.length;
      return rows.filter(r => r[col] !== null && r[col] !== undefined).length;
    case 'SUM':
      return rows.filter(r => typeof r[col] === 'number').reduce((sum, r) => sum + (Number(r[col]) || 0), 0);
    case 'AVG': {
      const nums = rows.filter(r => typeof r[col] === 'number').map(r => Number(r[col]));
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    }
    case 'MIN': {
      const nums = rows.filter(r => typeof r[col] === 'number').map(r => Number(r[col]));
      return nums.length > 0 ? Math.min(...nums) : null;
    }
    case 'MAX': {
      const nums = rows.filter(r => typeof r[col] === 'number').map(r => Number(r[col]));
      return nums.length > 0 ? Math.max(...nums) : null;
    }
    default:
      return null;
  }
}

function extractAlias(aggregateExpr: string): { expr: string; alias?: string } {
  const match = aggregateExpr.match(/^(.+)\s+AS\s+(\w+)$/i);
  if (match) {
    return { expr: match[1].trim(), alias: match[2] };
  }
  return { expr: aggregateExpr.trim() };
}

export function executeQuery(sql: string, state: DatabaseState): QueryResult {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { type: 'ok', message: '' };
  }
  const upperSql = trimmed.toUpperCase();
  if (upperSql === 'SHOW DATABASES') {
    const dbNames = Object.keys(state.databases);
    return {
      type: 'show_databases',
      columns: ['Database'],
      rows: dbNames.map(name => ({ Database: name })),
    };
  }
  if (upperSql.startsWith('CREATE DATABASE')) {
    const match = trimmed.match(/CREATE\s+DATABASE\s+(\w+)/i);
    if (!match) {
      return { type: 'error', error: "Syntax error: Expected CREATE DATABASE database_name" };
    }
    const dbName = match[1];
    if (state.databases[dbName]) {
      return { type: 'error', error: `Database '${dbName}' already exists` };
    }
    state.databases[dbName] = { name: dbName, tables: {} };
    saveState(state);
    return { type: 'ok', message: `Query OK, 1 row affected` };
  }
  if (upperSql.startsWith('DROP DATABASE')) {
    const match = trimmed.match(/DROP\s+DATABASE\s+(\w+)/i);
    if (!match) {
      return { type: 'error', error: "Syntax error: Expected DROP DATABASE database_name" };
    }
    const dbName = match[1];
    if (!state.databases[dbName]) {
      return { type: 'error', error: `Unknown database '${dbName}'` };
    }
    delete state.databases[dbName];
    if (state.currentDatabase === dbName) {
      state.currentDatabase = null;
    }
    saveState(state);
    return { type: 'ok', message: `Query OK, 1 row affected` };
  }
  if (upperSql.startsWith('USE')) {
    const match = trimmed.match(/USE\s+(\w+)/i);
    if (!match) {
      return { type: 'error', error: "Syntax error: Expected USE database_name" };
    }
    const dbName = match[1];
    if (!state.databases[dbName]) {
      return { type: 'error', error: `Unknown database '${dbName}'` };
    }
    state.currentDatabase = dbName;
    saveState(state);
    return { type: 'ok', message: `Database changed` };
  }
  if (!state.currentDatabase) {
    return { type: 'error', error: 'No database selected. Use USE database_name to select a database.' };
  }
  const currentDb = state.databases[state.currentDatabase];
  if (upperSql === 'SHOW TABLES') {
    const tableNames = Object.keys(currentDb. tables);
    const colName = 'Tables_in_' + state.currentDatabase;
    return {
      type: 'show_tables',
      columns: [colName],
      rows: tableNames.map(name => ({ [colName]: name })),
    };
  }
  if (upperSql.startsWith('SHOW TABLES')) {
    const tableNames = Object.keys(currentDb.tables);
    return {
      type: 'show_tables',
      columns: ['Tables_in_' + state.currentDatabase],
      rows: tableNames.map(name => ({ ['Tables_in_' + state.currentDatabase]: name })),
    };
  }
  if (upperSql.startsWith('DESCRIBE') || upperSql.startsWith('DESC')) {
    const match = trimmed.match(/DESCRIBE\s+(\w+)/i) || trimmed.match(/DESC\s+(\w+)/i);
    if (!match) {
      return { type: 'error', error: "Syntax error: Expected DESCRIBE table_name" };
    }
    const tableName = match[1];
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    return {
      type: 'describe',
      columns: ['Field', 'Type', 'Null', 'Key', 'Default'],
      rows: table.columns.map(col => ({
        Field: col.name,
        Type: col.type + (col.type === 'VARCHAR' ? '(255)' : ''),
        Null: col. nullable ? 'YES' : 'NO',
        Key: col.primaryKey ? 'PRI' : '',
        Default: col.default || '',
      })),
    };
  }
  if (upperSql.startsWith('CREATE TABLE')) {
    const parsed = parseCreateTable(trimmed);
    if (!parsed) {
      return { type: 'error', error: 'Syntax error in CREATE TABLE statement' };
    }
    const { tableName, columns } = parsed;
    if (currentDb.tables[tableName]) {
      return { type: 'error', error: `Table '${tableName}' already exists` };
    }
    currentDb.tables[tableName] = { name: tableName, columns, rows: [] };
    saveState(state);
    return { type: 'ok', message: `Query OK, 0 rows affected` };
  }
  if (upperSql.startsWith('DROP TABLE')) {
    const match = trimmed.match(/DROP\s+TABLE\s+(\w+)/i);
    if (!match) {
      return { type: 'error', error: "Syntax error: Expected DROP TABLE table_name" };
    }
    const tableName = match[1];
    if (!currentDb.tables[tableName]) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    delete currentDb.tables[tableName];
    saveState(state);
    return { type: 'ok', message: `Query OK, 0 rows affected` };
  }
  if (upperSql.startsWith('ALTER TABLE')) {
    const addMatch = trimmed.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(.+)$/i);
    if (addMatch) {
      const tableName = addMatch[1];
      const table = currentDb.tables[tableName];
      if (!table) {
        return { type: 'error', error: `Table '${tableName}' doesn't exist` };
      }
      const col = parseColumnDefinition(addMatch[2]);
      if (!col) {
        return { type: 'error', error: 'Syntax error in column definition' };
      }
      table.columns.push(col);
      saveState(state);
      return { type: 'ok', message: `Query OK, 0 rows affected` };
    }
    const dropMatch = trimmed.match(/ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(\w+)/i);
    if (dropMatch) {
      const tableName = dropMatch[1];
      const colName = dropMatch[2];
      const table = currentDb.tables[tableName];
      if (!table) {
        return { type: 'error', error: `Table '${tableName}' doesn't exist` };
      }
      const colIndex = table.columns.findIndex(c => c.name === colName);
      if (colIndex === -1) {
        return { type: 'error', error: `Column '${colName}' not found` };
      }
      table.columns.splice(colIndex, 1);
      saveState(state);
      return { type: 'ok', message: `Query OK, 0 rows affected` };
    }
    return { type: 'error', error: 'Syntax error in ALTER TABLE statement' };
  }
  if (upperSql.startsWith('INSERT')) {
    const parsed = parseInsert(trimmed);
    if (!parsed) {
      return { type: 'error', error: 'Syntax error in INSERT statement' };
    }
    const { tableName, columns, values } = parsed;
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    const cols = columns.length ? columns : table.columns.map(c => c.name);
    for (const valueSet of values) {
      const row: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        row[col] = valueSet[i];
      });
      table.rows.push(row);
    }
    saveState(state);
    return { type: 'ok', message: `Query OK, ${values.length} row(s) affected` };
  }
  if (upperSql.startsWith('SELECT')) {
    const parsed = parseSelect(trimmed);
    if (!parsed) {
      return { type: 'error', error: 'Syntax error in SELECT statement' };
    }
    const { columns, table: tableName, where, groupBy, having, orderBy, orderDesc, limit, offset, distinct } = parsed;
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }

    const expandedColumns = columns === '*' ? table.columns.map(c => c.name) : (typeof columns === 'string' ? [columns] : columns);
    
    let filteredRows = table.rows;
    if (where) {
      console.log('Filtering with where:', where);
      filteredRows = table.rows.filter(row => {
        const result = matchRow(row, where);
        console.log('Row match:', { row, where, result });
        return result;
      });
    }
    
    let resultRows: Record<string, unknown>[];
    let outputCols: string[];
    
    if (groupBy && groupBy.length > 0) {
      const groupedRows: Record<string, Record<string, unknown>[]> = {};
      
      for (const row of filteredRows) {
        const keyParts = groupBy.map(col => {
          const val = row[col];
          return val === null || val === undefined ? '__NULL__' : String(val);
        });
        const key = keyParts.join('|');
        if (!groupedRows[key]) {
          groupedRows[key] = [];
        }
        groupedRows[key].push(row);
      }
      
      const aliasMap: Record<string, string> = {};
      const columnExprs: string[] = expandedColumns;
       
      for (const colExpr of columnExprs) {
        const { expr, alias } = extractAlias(colExpr);
        if (alias) {
          aliasMap[alias] = expr;
        }
      }
      
      resultRows = [];
      for (const groupRows of Object.values(groupedRows)) {
        const resultRow: Record<string, unknown> = {};
        
        for (const colExpr of columnExprs) {
          const { expr, alias } = extractAlias(colExpr);
          const outKey = alias || expr;
          
          if (groupBy.includes(expr)) {
            resultRow[outKey] = groupRows[0][expr];
          } else {
            const aggExpr = parseAggregateExpr(expr);
            if (aggExpr) {
              resultRow[outKey] = computeAggregate(aggExpr.func, groupRows, aggExpr.column);
            } else {
              resultRow[outKey] = groupRows[0][expr];
            }
          }
        }
        
        resultRows.push(resultRow);
      }
      
      if (having) {
        const havingMatch = having.match(/^(\w+)\s*(>|<|>=|<=|=|!=|IS NULL|IS NOT NULL)\s*(\d+(?:\.\d+)?)?$/i);
        if (havingMatch) {
          const col = havingMatch[1];
          const op = havingMatch[2].toUpperCase();
          const targetVal = havingMatch[3] ? parseFloat(havingMatch[3]) : null;
          
          resultRows = resultRows.filter(row => {
            const rowVal = row[col];
            const numVal = typeof rowVal === 'number' ? rowVal : row[aliasMap[col]] as number;
            
            switch (op) {
              case '>': return numVal > targetVal!;
              case '<': return numVal < targetVal!;
              case '>=': return numVal >= targetVal!;
              case '<=': return numVal <= targetVal!;
              case '=': return numVal === targetVal;
              case '!=': return numVal !== targetVal;
              case 'IS NULL': return rowVal === null || rowVal === undefined;
              case 'IS NOT NULL': return rowVal !== null && rowVal !== undefined;
              default: return true;
            }
          });
        }
      }
      
      outputCols = columnExprs.map(expr => {
        const { alias } = extractAlias(expr);
        return alias || expr;
      });
      
    } else {
      const columnExprs: string[] = expandedColumns;
      
      const hasAggregate = columnExprs.some(expr => parseAggregateExpr(expr) !== null);
      
      if (hasAggregate) {
        const resultRow: Record<string, unknown> = {};
        for (const colExpr of columnExprs) {
          const { expr, alias } = extractAlias(colExpr);
          const outKey = alias || expr;
          
          const aggExpr = parseAggregateExpr(expr);
          if (aggExpr) {
            resultRow[outKey] = computeAggregate(aggExpr.func, filteredRows, aggExpr.column);
          } else {
            resultRow[outKey] = filteredRows[0]?.[expr];
          }
        }
        resultRows = [resultRow];
      } else {
        resultRows = filteredRows.map(row => {
          const resultRow: Record<string, unknown> = {};
          for (const colExpr of columnExprs) {
            const { expr, alias } = extractAlias(colExpr);
            const outKey = alias || expr;
            resultRow[outKey] = row[expr];
          }
          return resultRow;
        });
      }
      
      outputCols = columnExprs.map(expr => {
        const { alias } = extractAlias(expr);
        return alias || expr;
      });
    }
    
    if (distinct) {
      const seen = new Set<string>();
      resultRows = resultRows.filter(row => {
        const key = outputCols.map(col => String(row[col] ?? 'NULL')).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    
    if (orderBy && orderBy.length > 0) {
      resultRows.sort((a, b) => {
        for (let i = 0; i < orderBy.length; i++) {
          const col = orderBy[i];
          const desc = orderDesc?.[i] || false;
          const aVal = a[col];
          const bVal = b[col];
          
          let cmp = 0;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            cmp = aVal - bVal;
          } else {
            cmp = String(aVal).localeCompare(String(bVal));
          }
          if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
      });
    }
    
    if (offset !== undefined && offset > 0) {
      resultRows = resultRows.slice(offset);
    }
    
    if (limit !== undefined && limit > 0) {
      resultRows = resultRows.slice(0, limit);
    }
    
    return {
      type: 'select',
      columns: outputCols,
      rows: resultRows,
    };
  }
  if (upperSql.startsWith('UPDATE')) {
    const parsed = parseUpdate(trimmed);
    if (!parsed) {
      return { type: 'error', error: 'Syntax error in UPDATE statement' };
    }
    const { table: tableName, set, where } = parsed;
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    let affected = 0;
    for (const row of table.rows) {
      if (!where || matchRow(row, where)) {
        Object.assign(row, set);
        affected++;
      }
    }
    saveState(state);
    return { type: 'ok', message: `Query OK, ${affected} row(s) affected` };
  }
  if (upperSql.startsWith('DELETE')) {
    const parsed = parseDelete(trimmed);
    if (!parsed) {
      return { type: 'error', error: 'Syntax error in DELETE statement' };
    }
    const { table: tableName, where } = parsed;
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    const originalLength = table.rows.length;
    table.rows = table.rows.filter(row => !where || matchRow(row, where));
    const affected = originalLength - table.rows.length;
    saveState(state);
    return { type: 'ok', message: `Query OK, ${affected} row(s) affected` };
  }
  return { type: 'error', error: `Unknown command: ${trimmed.substring(0, 20)}...` };
}