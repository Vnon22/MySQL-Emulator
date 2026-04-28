import { useState, useEffect, useRef } from 'react';
import { loadState, resetDatabase, executeQuery } from './sqlEngine';
import type { DatabaseState, QueryResult } from './types';
import './App.css';

interface HistoryEntry {
  command: string;
  result: QueryResult;
}

function App() {
  const [state, setState] = useState<DatabaseState>({ databases: {}, currentDatabase: null });
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const upperInput = input.trim().toUpperCase();
    if (upperInput === 'CLEAR') {
      setHistory([]);
      setInput('');
      return;
    }
    const currentState = loadState();
    const result = executeQuery(input, currentState);
    const newState = loadState();
    setState(newState);
    setHistory(prev => [...prev, { command: input, result }]);
    setInput('');
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
      const colWidths = cols.map(col => Math.max(col.length, ...dataRows.map(row => String(row[col] || '').length)));
      const borderLine = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
      return (
        <table className="result-table">
          <tbody>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            <tr className="header-row">
              {cols.map((col, i) => (
                <td key={i}>{col}{' '.repeat(colWidths[i] - col.length + 1)}</td>
              ))}
            </tr>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {dataRows.map((row, ri) => (
              <tr key={ri} className="data-row">
                {cols.map((col, ci) => (
                  <td key={ci}>{String(row[col] || 'NULL')}{' '.repeat(colWidths[ci] - String(row[col] || 'NULL').length + 1)}</td>
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
      const colWidths = cols.map(col => Math.max(col.length, ...dataRows.map(row => String(row[col] || '').length)));
      const borderLine = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
      return (
        <table className="result-table">
          <tbody>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            <tr className="header-row">
              {cols.map((col, i) => (
                <td key={i}>{col}{' '.repeat(colWidths[i] - col.length + 1)}</td>
              ))}
            </tr>
            <tr className="border-row">
              <td colSpan={cols.length}>{borderLine}</td>
            </tr>
            {dataRows.map((row, ri) => (
              <tr key={ri} className="data-row">
                {cols.map((col, ci) => (
                  <td key={ci}>{String(row[col] || 'NULL')}{' '.repeat(colWidths[ci] - String(row[col] || 'NULL').length + 1)}</td>
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
        <h1 className="title">SQL Emulator</h1>
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
                {entry.command}
              </div>
              <div className="history-result">
                {renderTable(entry.result)}
              </div>
            </div>
          ))}
          <form onSubmit={handleSubmit} className="input-line">
            <span className="prompt">MariaDB [{dbName}]&gt; </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="command-input"
              spellCheck={false}
            />
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;