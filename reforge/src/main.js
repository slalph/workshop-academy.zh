// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, fchmodSync, fstatSync, linkSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { backup as sqliteBackup, constants, DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultData = join(root, 'data');
const data = resolve(process.env.DATA_DIR || defaultData);
const backups = resolve(process.env.BACKUP_DIR || join(root, 'backups'));
const run = join(data, 'run.json');
const database = join(data, 'academy.sqlite');
const migrationsDir = join(root, 'migrations');

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function readRun() {
  let fd;
  try {
    fd = openSync(run, 'r');
    const inode = fstatSync(fd);
    let record;
    try {
      record = JSON.parse(readFileSync(fd, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const service = typeof record?.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(record.url)
      && typeof record?.token === 'string' && record.token.length > 0;
    const valid = typeof record?.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt))
      && (service || typeof record?.task === 'string');
    return { inode, record: valid && alive(record.pid) ? record : null };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function removeRun(inode) {
  try {
    const current = statSync(run);
    if (current.dev === inode.dev && current.ino === inode.ino) unlinkSync(run);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function withRunGate(action) {
  // SQLite's file lock serializes inspection and removal of a stale run record.
  // The gate contains no database tables or ownership information.
  const path = join(data, '.run-gate');
  closeSync(openSync(path, 'a', 0o600));
  const gate = new DatabaseSync(path);
  try {
    gate.exec('PRAGMA busy_timeout = 3000; BEGIN EXCLUSIVE');
    return action();
  } finally {
    gate.close();
  }
}

function occupy(fields) {
  mkdirSync(data, { recursive: true });
  const temporary = join(data, `.run-${randomUUID()}.tmp`);
  const startedAt = new Date().toISOString();
  function publish(record) {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt, ...record }) + '\n');
      return fstatSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  let inode = publish(fields);
  try {
    withRunGate(() => {
      const previous = readRun();
      if (previous?.record) {
        const { pid, url, task } = previous.record;
        throw new Error(`数据目录已由进程 ${pid} 占用${url ? `（${url}）` : `（${task}）`}`);
      }
      if (previous) removeRun(previous.inode);
      linkSync(temporary, run);
    });
  } finally {
    unlinkSync(temporary);
  }
  return {
    update(record) {
      const next = publish(record);
      try {
        renameSync(temporary, run);
        inode = next;
      } catch (error) {
        unlinkSync(temporary);
        throw error;
      }
    },
    release() {
      removeRun(inode);
    },
  };
}

function migrationFiles() {
  const numbers = new Set();
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.sql'))
    .map(entry => entry.name)
    .sort()
    .map(name => {
      const match = /^(\d{3,})-[a-z0-9][a-z0-9-]*\.sql$/.exec(name);
      if (!match) throw new Error(`迁移文件名无效：${name}`);
      const number = BigInt(match[1]);
      if (numbers.has(number)) throw new Error(`迁移编号重复：${name}`);
      numbers.add(number);
      const content = readFileSync(join(migrationsDir, name));
      return { name, sql: content.toString('utf8'), checksum: createHash('sha256').update(content).digest('hex') };
    });
}

function migrationStatus(db, files = migrationFiles()) {
  const applied = db.prepare('SELECT name, checksum FROM schema_migrations ORDER BY name').all();
  for (const [index, record] of applied.entries()) {
    const file = files[index];
    if (!file || file.name !== record.name || file.checksum !== record.checksum) {
      throw new Error(`迁移历史冲突：已执行 ${record.name}，对应文件 ${file?.name || '缺失'} 的名称、顺序或校验和不一致`);
    }
  }
  return { applied: applied.map(record => record.name), pending: files.slice(applied.length) };
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    action();
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      if (!rollbackError.message.includes('no transaction is active')) throw rollbackError;
    }
    throw error;
  }
}

function applyMigrations(db, pending) {
  const insert = db.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)');
  for (const file of pending) {
    try {
      transaction(db, () => {
        // Keep each migration and its history row in the same transaction.
        db.setAuthorizer?.(action =>
          action === constants.SQLITE_TRANSACTION || action === constants.SQLITE_SAVEPOINT
            ? constants.SQLITE_DENY : constants.SQLITE_OK);
        try {
          db.exec(file.sql);
        } finally {
          db.setAuthorizer?.(null);
        }
        insert.run(file.name, file.checksum, Date.now());
      });
    } catch (error) {
      throw new Error(`迁移 ${file.name} 失败：${error.message}`);
    }
  }
}

function openDatabase(path, readOnly = false) {
  return new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true });
}

function openForMigrations() {
  const files = migrationFiles();
  const db = openDatabase(database);
  try {
    const tables = tableNames(db);
    const fresh = tables.size === 0;
    if (fresh) {
      db.exec(`
        CREATE TABLE schema_migrations (
          name TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        ) STRICT
      `);
    } else if (!tables.has('schema_migrations')) {
      throw new Error('迁移历史冲突：缺少 schema_migrations 表');
    }
    return { db, fresh, ...migrationStatus(db, files) };
  } catch (error) {
    db.close();
    throw error;
  }
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name));
}

function portFromEnvironment() {
  const raw = process.env.PORT ?? '3000';
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port > 65535) {
    throw new Error('PORT 必须是 0 至 65535 的整数');
  }
  return port;
}

async function start() {
  const port = portFromEnvironment();
  const stopToken = randomUUID();
  const ownership = occupy({ task: '启动' });
  let db;
  let server;
  let stopping = false;
  function close() {
    try {
      db?.close();
    } finally {
      ownership.release();
    }
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => server.closeAllConnections(), 2000);
    server.close(() => {
      clearTimeout(timeout);
      close();
    });
  }
  try {
    const state = openForMigrations();
    db = state.db;
    if (state.fresh) {
      applyMigrations(db, state.pending);
    } else if (state.pending.length) {
      throw new Error(`有待执行的迁移：${state.pending.map(file => file.name).join('、')}。请依次执行 npm run backup、npm run migrate、npm start`);
    }
    const { seed, makeHandler } = await import('./app.js');
    seed(db);
    function migrations() {
      const status = migrationStatus(db);
      return { applied: status.applied, pending: status.pending.map(file => file.name) };
    }
    server = createServer(makeHandler({ db, mediaRoot: join(root, 'media'), migrations, stopToken, stop }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    ownership.update({ url, token: stopToken });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(`访问地址：${url}\n数据目录：${data}\n示例账号：admin、student、student2，密码均为 123456`);
  } catch (error) {
    server?.close();
    close();
    throw error;
  }
}

function migrate() {
  const ownership = occupy({ task: 'migrate' });
  let db;
  try {
    const state = openForMigrations();
    db = state.db;
    applyMigrations(db, state.pending);
    console.log(state.pending.length
      ? `已执行迁移：${state.pending.map(file => file.name).join('、')}` : '无需迁移');
  } finally {
    try {
      db?.close();
    } finally {
      ownership.release();
    }
  }
}

function stats(db) {
  const checked = db.prepare('PRAGMA quick_check').all();
  if (checked.length !== 1 || checked[0].quick_check !== 'ok') {
    throw new Error('数据库快速完整性检查失败');
  }
  const names = tableNames(db);
  for (const name of ['schema_migrations', 'settings', 'users', 'courses']) {
    if (!names.has(name)) throw new Error(`数据库缺少必要的表：${name}`);
  }
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const courses = db.prepare('SELECT COUNT(*) AS count FROM courses').get().count;
  const migrations = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  return `账号 ${users}，课程 ${courses}，迁移 ${migrations}`;
}

function localTimestamp() {
  const date = new Date();
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function newBackup(prefix, writeSnapshot) {
  mkdirSync(backups, { recursive: true });
  const temporary = join(backups, `.backup-${randomUUID()}.tmp`);
  const label = data === defaultData ? '' : `-${basename(data)}`;
  const stem = `${prefix}${label}-${localTimestamp()}`;
  try {
    await writeSnapshot(temporary);
    for (let number = 0; ; number++) {
      const path = join(backups, `${stem}${number ? `-${number}` : ''}.sqlite`);
      try {
        linkSync(temporary, path);
        return path;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function stopForBackup() {
  const record = readRun()?.record;
  if (!record?.url) return record;
  const response = await fetch(`${record.url}/internal/stop`, {
    method: 'POST',
    headers: { 'x-maintenance-token': record.token },
    signal: AbortSignal.timeout(2500),
  });
  await response.text();
  if (response.status !== 202) throw new Error(`服务拒绝正常停止（HTTP ${response.status}）`);
  const deadline = Date.now() + 4000;
  while (readRun()?.record?.pid === record.pid) {
    if (Date.now() >= deadline) throw new Error(`等待进程 ${record.pid} 释放数据目录超时`);
    await delay(40);
  }
  return record;
}

function quoteShell(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function backup() {
  const previous = await stopForBackup();
  const port = previous?.url ? new URL(previous.url).port : portFromEnvironment();
  const ownership = occupy({ task: 'backup' });
  let db;
  try {
    if (!existsSync(database)) throw new Error(`数据库不存在：${database}`);
    db = openDatabase(database, true);
    const summary = stats(db);
    const path = await newBackup('academy', path => sqliteBackup(db, path));
    console.log(`已备份：${path}\n${summary}\n重启命令：DATA_DIR=${quoteShell(data)} PORT=${port} npm start`);
  } finally {
    try {
      db?.close();
    } finally {
      ownership.release();
    }
  }
}

async function backUpBeforeRestore() {
  let current;
  try {
    try {
      // Inspect without writing so a damaged database can be saved byte for byte.
      current = openDatabase(database, true);
      stats(current);
    } catch {
      return await newBackup('before-restore', path => copyFileSync(database, path));
    }
    return await newBackup('before-restore', path => sqliteBackup(current, path));
  } finally {
    current?.close();
  }
}

async function restore(argument) {
  if (!argument) throw new Error('请提供备份文件路径：npm run restore -- <备份文件>');
  const source = resolve(process.env.INIT_CWD || process.cwd(), argument);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`备份文件不存在或不是普通文件：${source}`);

  const ownership = occupy({ task: 'restore' });
  const temporary = join(data, `.restore-${randomUUID()}.tmp`);
  let snapshot;
  try {
    const sourceStat = statSync(source);
    const currentStat = existsSync(database) ? statSync(database) : null;
    if (source === database || (currentStat && (
      realpathSync(source) === realpathSync(database)
      || (sourceStat.dev === currentStat.dev && sourceStat.ino === currentStat.ino)
    ))) {
      throw new Error('不能使用当前数据库作为恢复快照');
    }
    snapshot = openDatabase(source, true);
    const summary = stats(snapshot);
    let reminder = '';
    try {
      const { pending } = migrationStatus(snapshot);
      if (pending.length) reminder = `\n有待执行的迁移：${pending.map(file => file.name).join('、')}。启动前请运行 npm run migrate`;
    } catch (error) {
      reminder = `\n启动前请解决迁移问题：${error.message}`;
    }
    await sqliteBackup(snapshot, temporary);
    const safetyBackup = currentStat ? await backUpBeforeRestore() : undefined;
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = database + suffix;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    renameSync(temporary, database);
    console.log(`已恢复：${source} → ${database}\n${summary}${safetyBackup ? `\n恢复前备份：${safetyBackup}` : ''}${reminder}`);
  } finally {
    try {
      snapshot?.close();
      if (existsSync(temporary)) unlinkSync(temporary);
    } finally {
      ownership.release();
    }
  }
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('请使用 Node.js 24 或更新版本');
  const [command = 'start', argument] = process.argv.slice(2);
  const actions = { start, migrate, backup, restore };
  if (!Object.hasOwn(actions, command)) throw new Error(`未知运维命令：${command}`);
  await actions[command](argument);
} catch (error) {
  console.error(`学堂运行失败：${error.message}`);
  process.exitCode = 1;
}
