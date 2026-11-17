// The SQL each database speaks, as far as the page writes it: what the editor calls it, which keywords it
// offers, how the first rows are asked for, how Format lays it out, and how the source's reader is named in
// dbtour.yaml, and how a name is quoted. SQL Server's T-SQL, SQLite's, and the standard for any other until it
// has its own. Pure, so it is tested in Node.
import { MSSQL, SQLDialect, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { sql as standard, sqlite, transactsql, type DialectOptions } from 'sql-formatter';

export interface Dialect {
  /** What the editor's bar calls it. */
  label: string;
  /** CodeMirror's: its keywords, and the quotes a name may take. */
  language: SQLDialect;
  /** sql-formatter's, for Format. */
  format: DialectOptions;
  /** How the first rows are asked for: TOP (n) after SELECT, or LIMIT n at the end. */
  rows: 'top' | 'limit';
  /** What dbtour.yaml says for the source's reader, for a page that has none. */
  reader: string;
  /** How the reader keeps a query from writing, in a few words after "Runs through X's reader, ". */
  readOnly: string;
  /** How a name that needs it is quoted: [brackets] in T-SQL, "double quotes" elsewhere. */
  quote: '[' | '"';
  /** The words the database reserves, in capitals: a name that is one is quoted. */
  reserved: Set<string>;
}

// The words T-SQL reserves, and GO, which the query check refuses as a statement too.
const tsqlReserved = new Set(
  ('ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK ' +
    'CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE ' +
    'CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC ' +
    'DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE ' +
    'EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL ' +
    'FUNCTION GO GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT ' +
    'INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF ' +
    'OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN ' +
    'PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION ' +
    'RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT ' +
    'SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER ' +
    'SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE ' +
    'TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE ' +
    'WHILE WITH WITHIN WRITETEXT').split(' '),
);

// SQLite's keywords (sqlite.org/lang_keywords.html). Some may stand as a name unquoted, but which depends on
// where, so every one is quoted.
const sqliteReserved = new Set(
  ('ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN BETWEEN BY ' +
    'CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE ' +
    'CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ' +
    'ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL ' +
    'GENERATED GLOB GROUP GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD ' +
    'INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL ' +
    'NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE ' +
    'RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS ' +
    'SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED UNION UNIQUE UPDATE ' +
    'USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT').split(' '),
);

/** Every database's reserved words: an alias dbtour makes up is none of them, in whichever it is written. */
export const everyReserved = new Set([...tsqlReserved, ...sqliteReserved]);

/** Names are not case-sensitive in either, so a completed OrderLines needs no quotes. */
const tsql = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });
// CodeMirror quotes a name it completes with the first of these: SQLite's "double quotes".
const lite = SQLDialect.define({ ...SQLite.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '"[`' });
const other = SQLDialect.define({ ...StandardSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });

const dialects: Record<string, Dialect> = {
  mssql: { label: 'T-SQL', language: tsql, format: transactsql, rows: 'top', reader: '${DBTOUR_MSSQL_READER}', readOnly: 'a read-only login: checked first, rolled back after', quote: '[', reserved: tsqlReserved },
  sqlite: { label: 'SQLite', language: lite, format: sqlite, rows: 'limit', reader: 'read-only', readOnly: 'the file opened read-only: checked first', quote: '"', reserved: sqliteReserved },
};

/** The dialect of a database's driver; standard SQL for one the page does not know yet. One object each, so a component can depend on it. */
export function dialectOf(driver: string | undefined): Dialect {
  const key = driver ?? 'mssql';
  return (dialects[key] ??= {
    label: 'SQL',
    language: other,
    format: standard,
    rows: 'limit',
    reader: `\${DBTOUR_${key.toUpperCase()}_READER}`,
    readOnly: 'a read-only login: checked first',
    quote: '"',
    reserved: everyReserved,
  });
}

/** A select list of the first `n` rows, and what ends the query: SELECT TOP (n) …, or SELECT … LIMIT n. */
export function firstRows(dialect: Dialect, n: number): { select: string; end?: string } {
  return dialect.rows === 'top' ? { select: `SELECT TOP (${n})` } : { select: 'SELECT', end: `LIMIT ${n}` };
}
