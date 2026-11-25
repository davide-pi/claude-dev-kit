#!/usr/bin/env node
/**
 * Tests for the statement filter Assert-ReadStatements of scripts/db-ro.ps1 (the only layer left when write
 * grants are accepted): comment markers inside literals or quoted identifiers must not hide a write.
 * Zero dependencies — `node:test` on Node 18+, plus pwsh 7.
 *
 *   node --test tools/db-ro-write-filter.test.mjs
 *
 * The function is lifted out of the script by its PowerShell AST and run in isolation with `Stop-Wrapper`
 * stubbed to throw. Nothing ever reaches a database. DBRO_FILTER_SCRIPT points at another copy of the script.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = process.env.DBRO_FILTER_SCRIPT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'db-ro.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh ? false : 'pwsh 7 not on PATH';

/** Runs Assert-ReadStatements (or Assert-PlainPgSql, which takes no engine) once per [sql, engine]; returns { ok, error } for each. */
function verdicts(cases, fn = 'Assert-ReadStatements') {
  const driver = `
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DBRO_SCRIPT, [ref]$null, [ref]$null)
    $def = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $env:DBRO_FN }, $true)
    function Stop-Wrapper([string]$Message, [int]$Code = 2) { throw "[$Code] $Message" }
    . ([scriptblock]::Create($def.Extent.Text))
    $out = foreach ($c in ($env:DBRO_JSON | ConvertFrom-Json)) {
      try {
        if ($env:DBRO_FN -eq 'Assert-PlainPgSql') { Assert-PlainPgSql $c.sql } else { Assert-ReadStatements $c.sql $c.engine }
        @{ ok = $true }
      } catch { @{ ok = $false; error = [string]$_.Exception.Message } }
    }
    ConvertTo-Json -InputObject @($out) -Compress`;
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', driver], {
    encoding: 'utf8',
    env: { ...process.env, DBRO_SCRIPT: SCRIPT, DBRO_FN: fn, DBRO_JSON: JSON.stringify(cases.map(([sql, engine]) => ({ sql, engine }))) },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const sqlserver = (list) => list.map((s) => [s, 'sqlserver']);
const postgres = (list) => list.map((s) => [s, 'postgres']);

function assertRefused(cases) {
  verdicts(cases).forEach((r, i) => {
    assert.equal(r.ok, false, `accepted: ${cases[i][0]}`);
    assert.match(r.error, /write grants were accepted/, cases[i][0]);
  });
}

test('given a literal holding -- before a DROP, when the filter checks it, then the DROP is seen and rejected', { skip }, () => {
  // Given
  const sql = ["SELECT '--'; DROP TABLE t; SELECT '--'", "SELECT 'a -- b'; DELETE FROM t; SELECT 1 -- x"];
  // When / Then
  assertRefused(sqlserver(sql));
});

test('given literals holding /* and */ around a DROP, when the filter checks it, then the DROP is seen and rejected', { skip }, () => {
  // Given
  const sql = ["SELECT '/*'; DROP TABLE t; SELECT '*/'", "SELECT '/*' AS a\nGO\nDROP TABLE t\nGO\nSELECT '*/' AS b"];
  // When / Then
  assertRefused(sqlserver(sql));
});

test('given a doubled quote inside a literal, when the filter checks it, then the literal stays one token and the write is rejected', { skip }, () => {
  // Given
  const sql = ["SELECT 'it''s --'; DELETE FROM t", "SELECT 'it''s /*'; DELETE FROM t; SELECT '*/'"];
  // When / Then
  assertRefused(sqlserver(sql));
});

test('given quoted identifiers holding -- or /*, when the filter checks a write after them, then it is rejected', { skip }, () => {
  // Given
  const sql = [
    'SELECT 1 AS "--"; DROP TABLE t; SELECT 1 AS "x"',
    'SELECT 1 AS "/*"; DROP TABLE t; SELECT 1 AS "*/"',
    'SELECT 1 AS [--]; DROP TABLE t; SELECT 1 AS [x]',
    'SELECT 1 AS [/*]; DROP TABLE t; SELECT 1 AS [*/]',
    'SELECT 1 AS `--`; DROP TABLE t; SELECT 1 AS `x`',
    'SELECT 1 AS `/*`; DROP TABLE t; SELECT 1 AS `*/`',
  ];
  // When / Then
  assertRefused(sqlserver(sql));
});

test('given a real comment that hides nothing, when the filter checks it, then the read passes; a write after a real block comment is rejected', { skip }, () => {
  // Given
  const plain = ['SELECT 1 -- note', 'SELECT 1 /* note */', "SELECT 1 /* it's */ AS a", "SELECT 'x' -- it's\nFROM t"];
  const refused = ['/* note */ DROP TABLE t', 'SELECT 1 /* note */; DROP TABLE t', 'SELECT 1 -- note\n; DROP TABLE t'];
  // When / Then
  verdicts(sqlserver(plain)).forEach((r, i) => assert.equal(r.ok, true, `${plain[i]} -> ${r.error}`));
  assertRefused(sqlserver(refused));
});

test('given a nested-looking comment or an unterminated literal or comment, when the filter checks it, then it is rejected', { skip }, () => {
  // Given
  const sql = [
    '/* /* */ DROP TABLE t',
    'SELECT 1 /* never closed',
    "SELECT 'never closed; DROP TABLE t",
    'SELECT "never closed',
    'SELECT [never closed',
    "SELECT 1; DROP TABLE t; SELECT '",
  ];
  // When / Then
  assertRefused(sqlserver(sql));
});

test('given plain reads, when the filter checks them, then each still passes on both engines', { skip }, () => {
  // Given
  const plain = [
    'SELECT 1',
    'select top 50 * from dbo.Orders where Id = 7;',
    'WITH t AS (SELECT 1 AS x) SELECT * FROM t',
    "select 'drop table x' as note",
    '-- delete everything\nSELECT updated_at FROM t',
    'SELECT 1\nGO\nSELECT 2',
    "SELECT 'it''s' AS a, \"Odd Name\" FROM t",
    'SELECT /* c */ 1; SELECT 2',
  ];
  // When / Then
  verdicts([...sqlserver(plain), ...postgres(plain)]).forEach((r, i) => assert.equal(r.ok, true, `${plain[i % plain.length]} -> ${r.error}`));
  verdicts(sqlserver(['SELECT [Order Id] FROM [dbo].[Orders]'])).forEach((r) => assert.equal(r.ok, true, r.error));
});

test('given Postgres dollar quotes and E strings, when the filter checks a write hidden behind them, then it is rejected', { skip }, () => {
  // Given
  const sql = [
    "SELECT $$'$$; DROP TABLE t; SELECT $$'$$",
    "SELECT $x$--$x$; DROP TABLE t; SELECT $x$--$x$",
    "SELECT E'\\''; DROP TABLE t; SELECT '",
    'SELECT $$never closed; DROP TABLE t',
  ];
  // When / Then
  assertRefused(postgres(sql));
  verdicts(postgres(['SELECT $$a -- b$$', "SELECT E'it\\'s' AS a"])).forEach((r) => assert.equal(r.ok, true, r.error));
});

test('given a $ right after a name character, when the filter checks a write after it, then no dollar quote opens and the write is rejected', { skip }, () => {
  // Given
  const sql = ['SELECT 1 AS a$$$; DROP TABLE t; SELECT 1 AS b$$', 'SELECT 1 AS €$$; DROP TABLE t; SELECT 1 AS x$$'];
  // When / Then
  assertRefused(postgres(sql));
});

test('given a dollar tag with non-ASCII characters or a stray $, when the filter checks a write after it, then it is rejected, and parameters, names and tags still pass', { skip }, () => {
  // Given
  const sql = [
    "SELECT $é$'$é$; DROP TABLE t; SELECT $é$'$é$",
    "SELECT $a€$'$a€$; DROP TABLE t; SELECT $a€$'$a€$",
    "SELECT $'; DROP TABLE t; SELECT '",
    'SELECT 1 + $',
  ];
  const plain = ['SELECT $1', 'SELECT a FROM t WHERE id = $12 AND b = $2', 'SELECT a$b FROM t', 'SELECT $é$x -- y$é$', 'SELECT $a€$x$a€$', 'SELECT $_t1$x$_t1$'];
  // When / Then
  assertRefused(postgres(sql));
  verdicts(postgres(plain)).forEach((r, i) => assert.equal(r.ok, true, `${plain[i]} -> ${r.error}`));
});

test('given a $ glued to a number, a parameter or a closed dollar quote, when the filter checks a write after it, then it reads it as the server does or refuses', { skip }, () => {
  // Given
  const sql = [
    "SELECT 1$$'$$; DROP TABLE t; SELECT 1$$'a$$",
    "SELECT 1.5e3$$'$$; DROP TABLE t; SELECT 1$$'a$$",
    "SELECT $1$$'$$; DROP TABLE t; SELECT $1$$'a$$",
    "SELECT $$a$$$$'$$; DROP TABLE t; SELECT $$a$$$$'a$$",
    "SELECT 1E'\\''; DROP TABLE t; SELECT '",
  ];
  const plain = ['SELECT $$x$$', 'SELECT a FROM t WHERE a=$1 AND b=$2', 'SELECT 1.5e3', 'SELECT .5, 1e-3, 1_000, x1$ FROM t', "SELECT abcE'it\\' FROM t"];
  // When / Then
  assertRefused(postgres(sql));
  verdicts(postgres(plain)).forEach((r, i) => assert.equal(r.ok, true, `${plain[i]} -> ${r.error}`));
});

test('given a \\d line holding a lone double quote around a write, when psql input is vetted, then both the meta-command check and the statement filter reject it', { skip }, () => {
  // Given
  const sql = ['\n', '\r\n', '\r'].map((nl) => ['SELECT 1;', '\\d "', 'DROP TABLE t;', '\\d "'].join(nl));
  // When
  const plain = verdicts(postgres(sql), 'Assert-PlainPgSql');
  // Then
  plain.forEach((r, i) => assert.equal(r.ok, false, `accepted by Assert-PlainPgSql: ${JSON.stringify(sql[i])}`));
  assertRefused(postgres(sql));
});

test('given a \\d line inside a multi-line quote, when the statement filter checks it, then it is rejected rather than read differently from psql', { skip }, () => {
  // Given
  const sql = ['SELECT 1 AS "a\n\\d x\n"', "SELECT 'a\n\\d x\n'"];
  // When / Then
  assertRefused(postgres(sql));
});

test('given \\d lines with balanced quotes or a dotted name before a SELECT, when psql input is vetted, then both checks pass', { skip }, () => {
  // Given
  const sql = ['\\d "My Table"\nSELECT 1', '\\d public.t\r\nSELECT 1', '\\dt+ public.*\rSELECT 2', 'SELECT 1;\n\\l\nSELECT 2'];
  // When / Then
  verdicts(postgres(sql), 'Assert-PlainPgSql').forEach((r, i) => assert.equal(r.ok, true, `${JSON.stringify(sql[i])} -> ${r.error}`));
  verdicts(postgres(sql)).forEach((r, i) => assert.equal(r.ok, true, `${JSON.stringify(sql[i])} -> ${r.error}`));
});

test('given backticks around a write on Postgres, when the filter checks it, then the backtick is not a quote and the write is rejected', { skip }, () => {
  // Given
  const sql = ['SELECT 1 `; DROP TABLE t; SELECT `'];
  // When / Then
  assertRefused(postgres(sql));
});

test('given a SQL Server write keyword with no ; before it, when the filter checks it, then it is rejected', { skip }, () => {
  // Given
  const sql = [
    'SELECT 1 DENY SELECT ON t TO public',
    "SELECT 1 BACKUP DATABASE d TO DISK='x'",
    "SELECT 1 RESTORE DATABASE d FROM DISK='x'",
    'SELECT 1 KILL 53',
    'SELECT 1 RECEIVE * FROM q',
    'SELECT 1 DISABLE TRIGGER ALL ON DATABASE',
    'SELECT 1 ENABLE TRIGGER ALL ON DATABASE',
    "SELECT 1 WRITETEXT t.c @p 'x'",
    "SELECT 1 UPDATETEXT t.c @p 0 NULL 'x'",
    'SELECT 1 DBCC FREEPROCCACHE',
    'SELECT 1 SHUTDOWN WITH NOWAIT',
  ];
  // When / Then
  assertRefused(sqlserver(sql));
  verdicts(sqlserver(['SELECT backup_date, trigger_name FROM t'])).forEach((r) => assert.equal(r.ok, true, r.error));
});
