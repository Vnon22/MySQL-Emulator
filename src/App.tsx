import { useState, useEffect, useRef } from 'react';
import { loadState, resetDatabase, executeQuery } from './sqlEngine';
import type { DatabaseState, QueryResult } from './types';
import logo from './assets/ExamFriendly_logo.png';
import './App.css';

const SQL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'ADD', 'TABLE', 'DATABASE', 'SHOW', 'USE', 'DESCRIBE', 'DESC', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'DISTINCT', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'IS', 'NULL', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'AUTO_INCREMENT', 'LIKE', 'IN', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'UNION', 'ALL', 'ORDER', 'GROUP'];
const SQL_FUNCTIONS = ['COUNT', 'MIN', 'MAX', 'SUM', 'AVG', 'CONCAT', 'LENGTH', 'UPPER', 'LOWER', 'SUBSTRING', 'TRIM', 'NOW', 'DATE', 'IFNULL', 'COALESCE'];

function highlightSQL(sql: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let remaining = sql;
  let key = 0;

  const tokenizer = /(\s+)|('[^']*')|(\d+\.?\d*)|([=!<>]=?|!=|<>)|([(),])/gi;
  let match;
  let lastIndex = 0;

  while ((match = tokenizer.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      const text = remaining.slice(lastIndex, match.index);
      const words = text.split(/(\s+)/);
      for (const word of words) {
        if (!word.trim()) {
          result.push(<span key={key++}>{word}</span>);
        } else {
          const upperWord = word.toUpperCase();
          if (SQL_FUNCTIONS.includes(upperWord)) {
            result.push(<span key={key++} className="sql-function">{word}</span>);
          } else if (SQL_KEYWORDS.includes(upperWord)) {
            result.push(<span key={key++} className="sql-keyword">{word}</span>);
          } else {
            result.push(<span key={key++}>{word}</span>);
          }
        }
      }
    }

    const [, whitespace, string, number, operator, punctuation] = match;
    if (whitespace) result.push(<span key={key++}>{whitespace}</span>);
    else if (string) result.push(<span key={key++} className="sql-string">{string}</span>);
    else if (number) result.push(<span key={key++} className="sql-number">{number}</span>);
    else if (operator) result.push(<span key={key++} className="sql-operator">{operator}</span>);
    else if (punctuation) result.push(<span key={key++}>{punctuation}</span>);

    lastIndex = tokenizer.lastIndex;
  }

  if (lastIndex < remaining.length) {
    const text = remaining.slice(lastIndex);
    const words = text.split(/(\s+)/);
    for (const word of words) {
      if (!word.trim()) {
        result.push(<span key={key++}>{word}</span>);
      } else {
        const upperWord = word.toUpperCase();
        if (SQL_FUNCTIONS.includes(upperWord)) {
          result.push(<span key={key++} className="sql-function">{word}</span>);
        } else if (SQL_KEYWORDS.includes(upperWord)) {
          result.push(<span key={key++} className="sql-keyword">{word}</span>);
        } else {
          result.push(<span key={key++}>{word}</span>);
        }
      }
    }
  }

  return result;
}

interface HistoryEntry {
  command: string;
  result: QueryResult;
}

function App() {
  const [state, setState] = useState<DatabaseState>({ databases: {}, currentDatabase: null });
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [clearConfirm, setClearConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex].command);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex].command);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      
      // Debug logging
      console.log('Enter pressed! Input:', input);
      
      const normalized = input.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      
      console.log('Normalized:', normalized, 'Has semicolon:', normalized.endsWith(';'));
      
      if (!normalized.endsWith(';')) {
        setInput(input + '\n');
      } else {
        if (normalized.toUpperCase() === 'CLEAR') {
          setHistory([]);
          setInput('');
          setHistoryIndex(-1);
          return;
        }
        const currentState = loadState();
        const query = normalized.slice(0, -1);
        
        console.log('Executing query:', query);
        
        const result = executeQuery(query, currentState);
        
        console.log('Result:', result);
        
        setState(currentState);
        setHistory(prev => [...prev, { command: input, result }]);
        setInput('');
        setHistoryIndex(-1);
      }
    }
  };

  const handleClearDatabase = () => {
    if (clearConfirm) {
      resetDatabase();
      setState({ databases: {}, currentDatabase: null });
      setHistory([{ command: 'CLEAR DATABASE', result: { type: 'ok', message: 'Database cleared successfully' } }]);
      setClearConfirm(false);
    } else {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3000);
    }
  };

  const renderTable = (result: QueryResult) => {
    if (result.type === 'error') {
      return <div className="error">ERROR {result.error}</div>;
    }
    if (result.type === 'ok' || result.type === 'show_databases' || result.type === 'show_tables' || result.type === 'describe') {
      if (result.error) return <div className="error">ERROR {result.error}</div>;
      if (result.message) return <div className="success">{result.message}</div>;
      if (!result.columns || result.columns.length === 0) {
        return <div className="empty-result">Empty set</div>;
      }
      const hasRows = result.rows && result.rows.length > 0;
      const dataRows = result.rows || [];
      const cols = result.columns || [];
      const colWidths = cols.map(col => Math.max(col.length, ...dataRows.map(row => String(row[col] == null ? 'NULL' : row[col]).length)));
      const borderLine = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
      return (
        <table className="result-table">
          <tbody>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            <tr className="header-row">
              {cols.map((col, i) => (
                <td key={i}>{col}{' '.repeat(Math.max(0, colWidths[i] - col.length + 1))}</td>
              ))}
            </tr>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {dataRows.map((row, ri) => (
              <tr key={ri} className="data-row">
                {cols.map((col, ci) => (
                  <td key={ci}>{String(row[col] == null ? 'NULL' : row[col])}{' '.repeat(Math.max(0, colWidths[ci] - String(row[col] == null ? 'NULL' : row[col]).length + 1))}</td>
                ))}
              </tr>
            ))}
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {hasRows && (
              <tr className="footer-row">
                <td colSpan={cols.length}>{dataRows.length} row{dataRows.length !== 1 ? 's' : ''} in set</td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }
    if (result.type === 'select') {
      if (!result.columns || result.columns.length === 0) {
        return <div className="empty-result">Empty set</div>;
      }
      const hasRows = result.rows && result.rows.length > 0;
      const dataRows = result.rows || [];
      const cols = result.columns || [];
      const colWidths = cols.map(col => Math.max(col.length, ...dataRows.map(row => String(row[col] == null ? 'NULL' : row[col]).length)));
      const borderLine = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
      return (
        <table className="result-table">
          <tbody>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            <tr className="header-row">
              {cols.map((col, i) => (
                <td key={i}>{col}{' '.repeat(Math.max(0, colWidths[i] - col.length + 1))}</td>
              ))}
            </tr>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {dataRows.map((row, ri) => (
              <tr key={ri} className="data-row">
                {cols.map((col, ci) => (
                  <td key={ci}>{String(row[col] == null ? 'NULL' : row[col])}{' '.repeat(Math.max(0, colWidths[ci] - String(row[col] == null ? 'NULL' : row[col]).length + 1))}</td>
                ))}
              </tr>
            ))}
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {hasRows && (
              <tr className="footer-row">
                <td colSpan={cols.length}>{dataRows.length} row{dataRows.length !== 1 ? 's' : ''} in set</td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }
    return null;
  };

  const dbName = state.currentDatabase || 'none';

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src={logo} alt="ExamFriendly" className="logo" />
          <h1 className="title">SQL Emulator</h1>
        </div>
        <button 
          className={`clear-btn ${clearConfirm ? 'confirm' : ''}`}
          onClick={handleClearDatabase}
        >
          {clearConfirm ? 'Confirm Clear' : 'Clear Database'}
        </button>
      </header>
      <div className="terminal" ref={terminalRef} onClick={() => inputRef.current?.focus()}>
        <div className="terminal-content">
          {history.map((entry, i) => (
            <div key={i} className="history-entry">
              <div className="history-command">
                <span className="prompt">MariaDB [{dbName}]&gt; </span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{highlightSQL(entry.command)}</span>
              </div>
              <div className="history-result">
                {renderTable(entry.result)}
              </div>
            </div>
          ))}
          <form onSubmit={(e) => e.preventDefault()} className="input-line">
            <span className="prompt">MariaDB [{dbName}]&gt; </span>
            <textarea
              ref={inputRef as any}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="command-input"
              spellCheck={false}
              style={{ minHeight: '21px', height: input.split('\n').length * 21 + 'px' }}
            />
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;