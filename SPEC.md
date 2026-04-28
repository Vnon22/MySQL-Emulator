# MySQL Emulator - Specification Document

## 1. Project Overview

**Project Name:** SQL Emulator  
**Type:** Web Application (Interactive CLI)  
**Core Functionality:** A browser-based MySQL/MariaDB command-line emulator that allows users to practice SQL commands with local storage persistence  
**Target Users:** Students learning SQL, developers testing queries

---

## 2. UI/UX Specification

### Layout Structure

- **Single page application** with terminal-style interface
- **Header:** Minimal - app title + clear database button
- **Main Area:** Full-screen terminal emulator
- **No footer** - maximizes terminal space

### Visual Design

**Color Palette:**
- Background: `#0d1117` (deep dark blue-black)
- Terminal Background: `#161b22` (slightly lighter dark)
- Primary Text: `#c9d1d9` (soft white)
- Accent/Prompt: `#58a6ff` (mysql blue)
- Success: `#3fb950` (green)
- Error: `#f85149` (red)
- Warning: `#d29922` (amber)
- Table Border: `#30363d` (muted gray)
- Selection: `#388bfd4` (cursor blue)

**Typography:**
- Font Family: `'IBM Plex Mono', 'Fira Code', 'Consolas', monospace`
- Terminal Text Size: `14px`
- Line Height: `1.5`

**Spacing:**
- Terminal Padding: `16px`
- Input Prompt Gap: `8px`
- History Item Gap: `4px`

**Visual Effects:**
- Subtle box shadow on terminal container
- Blinking cursor effect
- Smooth scroll for history
- No gradients - clean flat design

### Components

**1. Header Bar**
- Height: `48px`
- Contains: App title (left), Clear DB button (right)
- Clear button: red outlined style with hover fill

**2. Terminal Output Area**
- Scrollable container showing query history
- Each entry shows: command executed, output/results
- Tables rendered with proper alignment
- Error messages in red
- Success messages in green

**3. Input Area**
- Fixed at bottom
- Shows MariaDB prompt: `MariaDB [database_name]> `
- Input field with blinking cursor
- Auto-focus on load and after each command

**4. Command Prompt**
- Current database name in prompt (or "none")
- SQL keywords highlighted in accent color (optional enhancement)

---

## 3. Functional Specification

### Core Features

#### Supported SQL Commands

**DDL (Data Definition Language):**
- `CREATE DATABASE [name]` - Create new database
- `CREATE TABLE [name] (...)` - Create table with columns
- `DROP DATABASE [name]` - Delete database
- `DROP TABLE [name]` - Delete table
- `ALTER TABLE [name] ADD COLUMN ...` - Add column
- `ALTER TABLE [name] DROP COLUMN ...` - Drop column

**DML (Data Manipulation Language):**
- `SELECT [columns] FROM [table] [WHERE condition]` - Query data
- `INSERT INTO [table] (columns) VALUES (values)` - Insert row
- `UPDATE [table] SET column=value WHERE condition` - Update rows
- `DELETE FROM [table] WHERE condition` - Delete rows

**Utility Commands:**
- `SHOW DATABASES` - List all databases
- `SHOW TABLES` - List tables in current database
- `DESCRIBE [table]` / `DESC [table]` - Show table structure
- `USE [database_name]` - Switch active database

### User Interactions

1. **Typing Commands:** Enter SQL in input field
2. **Executing:** Press Enter to submit
3. **History Navigation:** Up/Down arrows (optional)
4. **Clear Screen:** `CLEAR` command
5. **Reset:** Click "Clear Database" button

### Data Handling

**Local Storage Persistence:**
- Store all databases/tables/data in localStorage
- Key: `sql_emulator_data`
- Auto-save on every change
- Auto-load on app start

**Data Structure:**
```typescript
interface Database {
  name: string;
  tables: Record<string, Table>;
}

interface Table {
  name: string;
  columns: Column[];
  rows: Record<string, any>[];
}

interface Column {
  name: string;
  type: 'INT' | 'VARCHAR' | 'TEXT' | 'DATE' | 'BOOLEAN';
  primaryKey?: boolean;
  nullable?: boolean;
}
```

### Query Validation

- Parse SQL syntax before execution
- Show meaningful error messages:
  - "Syntax error near '...'"
  - "Unknown database '...'"
  - "Table '...' doesn't exist"
  - "Column '...' not found"

### State Reset

- "Clear Database" button clears localStorage
- Resets to initial state (no databases)
- Confirmation alert before resetting

---

## 4. Acceptance Criteria

1. App loads without errors in browser
2. `SHOW DATABASES` displays empty list initially
3. `CREATE DATABASE test_db` creates database successfully
4. `USE test_db` switches to that database
5. `CREATE TABLE users (id INT, name VARCHAR(50))` creates table
6. `INSERT INTO users (id, name) VALUES (1, 'Alice')` inserts row
7. `SELECT * FROM users` shows inserted data in table format
8. Page refresh retains all data (localStorage working)
9. "Clear Database" button resets everything
10. Invalid SQL shows appropriate error message
11. Interface looks like MariaDB/MySQL command prompt

---

## 5. Technical Stack

- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** CSS Modules or plain CSS
- **Storage:** localStorage API
- **No external dependencies** for SQL parsing (custom implementation)