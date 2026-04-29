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
    values.push(vals);
  }
  return { tableName, columns, values };
}

function parseSelect(sql: string): { columns: string | string[]; table: string; where?: string; orderBy?: string; limit?: number } | null {
  const cleanSql = sql.trim();
  const upperSql = cleanSql.toUpperCase();
  
  const fromIndex = upperSql.indexOf('FROM');
  if (fromIndex === -1) return null;
  
  const selectPart = cleanSql.substring(6, fromIndex).trim();
  const columns = selectPart === '*' ? '*' : selectPart.split(',').map(c => c.trim());
  
  const afterFrom = cleanSql.substring(fromIndex + 4).trim();
  const tableMatch = afterFrom.match(/^(\w+)/);
  if (!tableMatch) return null;
  const table = tableMatch[1];
  
  const remaining = afterFrom.substring(table.length).trim();
  
  let where: string | undefined;
  let orderBy: string | undefined;
  let limit: number | undefined;
  
  const whereIndex = remaining.toUpperCase().indexOf('WHERE');
  const orderIndex = remaining.toUpperCase().indexOf('ORDER BY');
  const limitIndex = remaining.toUpperCase().indexOf('LIMIT');
  
  if (whereIndex !== -1) {
    let end = remaining.length;
    if (orderIndex !== -1) end = Math.min(end, orderIndex);
    if (limitIndex !== -1) end = Math.min(end, limitIndex);
    where = remaining.substring(whereIndex + 5, end).trim();
  }
  
  if (orderIndex !== -1) {
    let end = remaining.length;
    if (whereIndex !== -1 && whereIndex < orderIndex) {
      end = remaining.length;
    } else if (whereIndex !== -1) {
      end = whereIndex;
    }
    if (limitIndex !== -1 && limitIndex > orderIndex) {
      end = Math.min(end, limitIndex);
    }
    const orderPart = remaining.substring(orderIndex + 8, end).trim();
    if (orderPart) orderBy = orderPart;
  }
  
  if (limitIndex !== -1) {
    const limitPart = remaining.substring(limitIndex + 6).trim();
    const limitNum = parseInt(limitPart);
    if (!isNaN(limitNum)) limit = limitNum;
  }
  
  return { columns, table, where, orderBy, limit };
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
  if (!where || where.trim() === '') return true;
  
  function matchesPattern(str: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i').test(str);
  }
  
  function parseValue(val: string): { value: string | number; isNumber: boolean } {
    if (/^-?\d+\.?\d*$/.test(val)) {
      return { value: parseFloat(val), isNumber: true };
    } else if (/^'([^']*)'$/.test(val)) {
      return { value: val.slice(1, -1), isNumber: false };
    } else if (/^\(.*\)$/.test(val)) {
      return { value: val, isNumber: false };
    }
    return { value: val, isNumber: false };
  }
  
  try {
    function splitConditions(where: string): string[] {
      const result: string[] = [];
      let current = '';
      let parenLevel = 0;
      let i = 0;
      
      while (i < where.length) {
        const remaining = where.substring(i);
        
        if (parenLevel === 0) {
          if (/^BETWEEN\s+/i.test(remaining)) {
            const betweenMatch = remaining.match(/^BETWEEN\s+(\d+|'[^']*'?)\s+AND\s+(\d+|'[^']*'?)/i);
            if (betweenMatch) {
              result.push(betweenMatch[0].trim());
              i += betweenMatch[0].length;
              continue;
            }
          }
          
          const colBetween = remaining.match(/^(\w+)\s+BETWEEN\s+(\d+|'[^']*'?)\s+AND\s+(\d+|'[^']*'?)/i);
          if (colBetween) {
            result.push(colBetween[0].trim());
            i += colBetween[0].length;
            continue;
          }
          
          if (/^IN\s*\(/i.test(remaining)) {
            let end = i + 2;
            let p = 1;
            while (end < where.length && p > 0) {
              if (where[end] === '(') p++;
              else if (where[end] === ')') p--;
              end++;
            }
            result.push(where.substring(i, end).trim());
            i = end;
            continue;
          }
          
          if (/^\bAND\b/i.test(remaining)) {
            if (current.trim()) {
              result.push(current.trim());
            }
            result.push('AND');
            i += 3;
            current = '';
            continue;
          }
          
          if (/^\bOR\b/i.test(remaining)) {
            if (current.trim()) {
              result.push(current.trim());
            }
            result.push('OR');
            i += 2;
            current = '';
            continue;
          }
        }
        
        if (remaining[0] === '(') parenLevel++;
        else if (remaining[0] === ')') parenLevel--;
        
        current += remaining[0];
        i++;
      }
      
      if (current.trim()) {
        result.push(current.trim());
      }
      
      return result;
    }
    
    const conditions = splitConditions(where);
    
    let result = true;
    let lastOp = 'AND';
    
    for (const token of conditions) {
      const trimmed = token.trim().toUpperCase();
      if (trimmed === 'AND') {
        lastOp = 'AND';
        continue;
      } else if (trimmed === 'OR') {
        lastOp = 'OR';
        continue;
      }
      
      const condMatch = token.match(/\s*(\w+)\s*(=|!=|<>|<|>|>=|<=|LIKE|IN|BETWEEN)\s*(.+)/);
      if (!condMatch) continue;
      
      const colName = condMatch[1];
      const operator = condMatch[2].toUpperCase();
      let compareValue: string = condMatch[3].trim();
      let condResult = false;
      
      const rowValue = row[colName];
      
      // Handle LIKE
      if (operator === 'LIKE') {
        if (rowValue === null || rowValue === undefined) {
          condResult = false;
        } else {
          const pattern = compareValue.replace(/^'|'$/g, '');
          condResult = matchesPattern(String(rowValue), pattern);
        }
      }
      // Handle IN
      else if (operator === 'IN') {
        const valuesStr = compareValue.replace(/^\(|\)$/g, '').trim();
        const values: (string | number)[] = valuesStr.split(',').map(v => {
          v = v.trim();
          if (/^'([^']*)'$/.test(v)) return v.slice(1, -1).toLowerCase();
          if (/^-?\d+\.?\d*$/.test(v)) return parseFloat(v);
          return v.toLowerCase();
        });
        if (rowValue === null || rowValue === undefined) {
          condResult = false;
        } else {
          const rowVal = typeof rowValue === 'string' ? rowValue.toLowerCase() : rowValue;
          condResult = values.some(v => {
            if (typeof v === 'number' && typeof rowVal === 'number') return v === rowVal;
            if (typeof v === 'string' && typeof rowVal === 'string') return v === rowVal;
            return false;
          });
        }
      }
      // Handle BETWEEN
      else if (operator === 'BETWEEN') {
        const betweenParts = compareValue.split(/\s+AND\s+/i);
        if (betweenParts.length === 2) {
          let v1 = betweenParts[0].trim();
          let v2 = betweenParts[1].trim();
          v1 = v1.replace(/^'|'$/g, '');
          v2 = v2.replace(/^'|'$/g, '');
          const isNum1 = /^-?\d+\.?\d*$/.test(v1);
          const isNum2 = /^-?\d+\.?\d*$/.test(v2);
          if (rowValue === null || rowValue === undefined) {
            condResult = false;
          } else if (isNum1 && isNum2) {
            const num = Number(rowValue);
            const num1 = parseFloat(v1);
            const num2 = parseFloat(v2);
            condResult = num >= num1 && num <= num2;
          } else {
            const strVal = String(rowValue).toLowerCase();
            const str1 = String(v1).toLowerCase();
            const str2 = String(v2).toLowerCase();
            condResult = strVal >= str1 && strVal <= str2;
          }
        }
      }
      // Handle standard operators (=, !=, <, >, <=, >=)
      else {
        const { value, isNumber } = parseValue(compareValue);
        
        if (rowValue === undefined || rowValue === null) {
          condResult = false;
        } else if (isNumber) {
          const numRow = Number(rowValue);
          const numCompare = Number(value);
          switch (operator) {
            case '=': condResult = numRow === numCompare; break;
            case '!=': case '<>': condResult = numRow !== numCompare; break;
            case '<': condResult = numRow < numCompare; break;
            case '>': condResult = numRow > numCompare; break;
            case '<=': condResult = numRow <= numCompare; break;
            case '>=': condResult = numRow >= numCompare; break;
            default: condResult = numRow === numCompare;
          }
        } else {
          const strRow = String(rowValue).toLowerCase();
          const strCompare = String(value).toLowerCase();
          switch (operator) {
            case '=': condResult = strRow === strCompare; break;
            case '!=': case '<>': condResult = strRow !== strCompare; break;
            default: condResult = strRow === strCompare;
          }
        }
      }
      
      if (conditions.indexOf(token) === 0 || (conditions.indexOf(token) === 1 && conditions[0].trim() === '')) {
        result = condResult;
      } else if (lastOp === 'AND') {
        result = result && condResult;
      } else {
        result = result || condResult;
      }
    }
    
    return result;
  } catch (e) {
    console.error("matchRow error:", e, "where:", where);
    return false;
  }
}

export function executeQuery(sql: string, state: DatabaseState): QueryResult {
  const trimmed = sql.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return { type: 'ok', message: '' };
  }
  const upperSql = trimmed.toUpperCase();
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
  if (upperSql.startsWith('SHOW DATABASES')) {
    const dbNames = Object.keys(state.databases);
    return {
      type: 'show_databases',
      columns: ['Database'],
      rows: dbNames.map(name => ({ Database: name })),
    };
  }
  if (!state.currentDatabase) {
    return { type: 'error', error: 'No database selected. Use USE database_name to select a database.' };
  }
  const currentDb = state.databases[state.currentDatabase];
  if (upperSql === 'SHOW TABLES') {
    const tableNames = Object.keys(currentDb.tables);
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
        Null: col.nullable ? 'YES' : 'NO',
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
    const { columns, table: tableName, where, orderBy, limit } = parsed;
    const table = currentDb.tables[tableName];
    if (!table) {
      return { type: 'error', error: `Table '${tableName}' doesn't exist` };
    }
    let filteredRows = table.rows;
    if (where) {
      filteredRows = table.rows.filter(row => matchRow(row, where));
    }
    if (orderBy) {
      const isDesc = orderBy.toUpperCase().includes('DESC');
      const sortCol = orderBy.replace(/\s+DESC\s*$/i, '').replace(/\s+ASC\s*$/i, '').trim();
      filteredRows = [...filteredRows].sort((a, b) => {
        const aVal = a[sortCol];
        const bVal = b[sortCol];
        if (aVal === null || aVal === undefined) return isDesc ? -1 : 1;
        if (bVal === null || bVal === undefined) return isDesc ? 1 : -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return isDesc ? bVal - aVal : aVal - bVal;
        }
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        return isDesc ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
      });
    }
    if (limit !== undefined && limit > 0) {
      filteredRows = filteredRows.slice(0, limit);
    }
    // Convert columns to array - handle '*' case properly
    const columnsArray = columns === '*' ? table.columns.map(c => c.name) : (columns as string[]);
    
    const hasAggregate = columnsArray.some((col: string) => {
      const upperCol = col.toUpperCase();
      return ['COUNT', 'MIN', 'MAX', 'SUM', 'AVG'].includes(upperCol);
    });
    if (hasAggregate && columnsArray.length === 1) {
      const col = columnsArray[0];
      const upperCol = col.toUpperCase();
      if (upperCol === 'COUNT(*)') {
        return { type: 'select', columns: ['COUNT(*)'], rows: [{ 'COUNT(*)': filteredRows.length }] };
      }
      if (upperCol.startsWith('COUNT(')) {
        const columnName = col.match(/COUNT\((\w+)\)/i)?.[1];
        if (columnName) {
          const values = filteredRows.map(r => r[columnName]).filter(v => v !== null && v !== undefined);
          return { type: 'select', columns: [col], rows: [{ [col]: values.length }] };
        }
      }
      if (upperCol.startsWith('MIN(')) {
        const columnName = col.match(/MIN\((\w+)\)/i)?.[1];
        if (columnName) {
          const values = filteredRows.map(r => r[columnName]).filter(v => typeof v === 'number');
          return { type: 'select', columns: [col], rows: [{ [col]: values.length > 0 ? Math.min(...values) : null }] };
        }
      }
      if (upperCol.startsWith('MAX(')) {
        const columnName = col.match(/MAX\((\w+)\)/i)?.[1];
        if (columnName) {
          const values = filteredRows.map(r => r[columnName]).filter(v => typeof v === 'number');
          return { type: 'select', columns: [col], rows: [{ [col]: values.length > 0 ? Math.max(...values) : null }] };
        }
      }
      if (upperCol.startsWith('SUM(')) {
        const columnName = col.match(/SUM\((\w+)\)/i)?.[1];
        if (columnName) {
          const values = filteredRows.map(r => r[columnName]).filter(v => typeof v === 'number');
          const sum = values.reduce((a: number, b: number) => a + b, 0);
          return { type: 'select', columns: [col], rows: [{ [col]: sum }] };
        }
      }
      if (upperCol.startsWith('AVG(')) {
        const columnName = col.match(/AVG\((\w+)\)/i)?.[1];
        if (columnName) {
          const values = filteredRows.map(r => r[columnName]).filter(v => typeof v === 'number');
          const avg = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null;
          return { type: 'select', columns: [col], rows: [{ [col]: avg }] };
        }
      }
    }
    const outputRows = filteredRows.map(row => {
      const output: Record<string, unknown> = {};
      columnsArray.forEach(col => {
        const upperCol = col.toUpperCase();
        if (upperCol.startsWith('COUNT(') || upperCol.startsWith('MIN(') || upperCol.startsWith('MAX(') || upperCol.startsWith('SUM(') || upperCol.startsWith('AVG(')) {
          const columnName = col.match(/\((\w+)\)/i)?.[1];
          if (columnName && row[columnName] !== undefined) {
            output[col] = row[columnName];
          } else {
            output[col] = col;
          }
        } else {
          output[col] = row[col];
        }
      });
      return output;
    });
    const outputCols = columns === '*' 
      ? table.columns.map(c => c.name)
      : columns as string[];
    return {
      type: 'select',
      columns: outputCols,
      rows: outputRows,
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