export interface Column {
  name: string;
  type: 'INT' | 'VARCHAR' | 'TEXT' | 'DATE' | 'BOOLEAN' | 'FLOAT' | 'DOUBLE';
  primaryKey?: boolean;
  nullable?: boolean;
  autoIncrement?: boolean;
  default?: string;
}

export interface Table {
  name: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}

export interface Database {
  name: string;
  tables: Record<string, Table>;
}

export type QueryResult = {
  type: 'ok' | 'error' | 'select' | 'show_databases' | 'show_tables' | 'describe';
  message?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  error?: string;
};

export interface DatabaseState {
  databases: Record<string, Database>;
  currentDatabase: string | null;
}