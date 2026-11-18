// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const project = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const courseVideos = [
  ['python-basics.mp4', 18, 1],
  ['git-essentials.mp4', 20, 1],
  ['web-api-testing.mp4', 22, 1],
  ['sqlite-modeling.mp4', 16, 0],
];

const expectedExamples = [
  [
    'Python 入门：写出第一个程序',
    '从变量、条件和循环开始，用一个猜数字小游戏把基础语法串起来。',
    [
      '这门课面向从没写过代码的同学。我们先装好 Python，再一步步写出一个能和你对话的猜数字游戏。',
      '每一节都先演示、再动手：你会认识变量与类型、if 判断、while 循环和函数，并学会读懂报错信息。',
      '学完后，你能独立写出几十行的小程序，并知道下一步该学什么。',
    ].join('\n\n'),
    '林知远', 'beginner', 'python-basics.mp4', 18,
  ],
  [
    '用 Git 管好每一次修改',
    '提交、分支与合并：在团队里放心地改代码，出错也能找回来。',
    [
      '把 Git 当成代码的“时光机”。课程从第一次提交讲起，覆盖查看历史、撤销修改、创建分支和合并冲突。',
      '我们用一个多人协作的小项目演示常见场景：两个人改了同一行怎么办？提交写错了怎么补救？',
      '课程最后整理一份团队提交约定，可以直接用到你的项目里。',
    ].join('\n\n'),
    '周若溪', 'beginner', 'git-essentials.mp4', 20,
  ],
  [
    'Web 接口设计与测试',
    '用 HTTP 工具直接调用接口，读懂状态码，写出可重复执行的接口测试。',
    [
      '页面背后是一组 HTTP 接口。本课教你用 curl 和浏览器开发者工具观察请求与响应，理解方法、路径、状态码和 JSON 结构。',
      '接着我们设计一组课程接口：哪些需要登录、出错时返回什么、怎样避免越权访问。',
      '最后把这些约定写成自动化测试，每次修改后一条命令就能确认接口仍然正确。',
    ].join('\n\n'),
    '陈墨', 'intermediate', 'web-api-testing.mp4', 22,
  ],
  [
    'SQLite 数据建模实践',
    '从需求出发设计表结构，用迁移脚本安全地演进数据库。',
    [
      '这门课还在准备中，供管理员练习发布流程。',
      '内容涵盖表与字段设计、约束与索引、编写迁移脚本，以及迁移前后如何备份与核对数据。',
    ].join('\n\n'),
    '许清', 'intermediate', 'sqlite-modeling.mp4', 16,
  ],
];

function fixture(t, overrides = {}) {
  const cwd = mkdtempSync(join(project, '.operations-'));
  for (const name of ['package.json', 'src', 'migrations', 'scripts']) {
    cpSync(join(project, name), join(cwd, name), { recursive: true });
  }
  const data = join(cwd, 'local-data');
  const backupDir = join(cwd, 'snapshots');
  const dbPath = join(data, 'academy.sqlite');
  const runPath = join(data, 'run.json');
  const env = { ...process.env, DATA_DIR: data, BACKUP_DIR: backupDir, PORT: '0', ...overrides };
  delete env.INIT_CWD;
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      const recordedPid = existsSync(runPath) ? readRun()?.pid : null;
      if (recordedPid) {
        try {
          process.kill(recordedPid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      } else {
        child.kill();
      }
      await once(child, 'exit');
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  function readRun() {
    return JSON.parse(readFileSync(runPath, 'utf8'));
  }

  function command(args, extra = {}) {
    return execute('npm', args, { cwd, env: { ...env, ...extra }, timeout: 12_000 });
  }

  async function start() {
    const npm = spawn('npm', ['start'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(npm);
    const exited = once(npm, 'exit');
    npm.once('exit', () => children.delete(npm));
    let stdout = '';
    let stderr = '';
    npm.stdout.on('data', chunk => { stdout += chunk; });
    npm.stderr.on('data', chunk => { stderr += chunk; });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (existsSync(runPath) && /访问地址/.test(stdout)) {
        return { ...readRun(), stdout, exited };
      }
      if (npm.exitCode !== null) throw new Error(`启动失败：${stdout}\n${stderr}`);
      await delay(25);
    }
    throw new Error(`启动超时：${stdout}\n${stderr}`);
  }

  function inspect(callback, path = dbPath) {
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      return callback(db);
    } finally {
      db.close();
    }
  }

  return { cwd, data, backupDir, dbPath, runPath, env, command, start, inspect };
}

function failure(message) {
  return error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /学堂运行失败/);
    assert.match(error.stderr, message);
    return true;
  };
}

function login(url, username = 'admin') {
  return fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: '123456' }),
  });
}

test('operations-19：本机启动、互斥、异常重启及幂等示例', async t => {
  const local = fixture(t);
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
  assert.match((await local.command(['run', 'migrate'], { DATA_DIR: '', PORT: '' })).stdout, /已执行迁移/);
  assert.ok(existsSync(join(local.cwd, 'data', 'academy.sqlite')));
  assert.match((await local.command(['run', 'backup'], { DATA_DIR: '', BACKUP_DIR: '', PORT: '3000' })).stdout,
    /academy-\d{8}-\d{6}\.sqlite/);
  await assert.rejects(local.command(['start'], { PORT: '65536' }), failure(/PORT/));
  mkdirSync(local.data);
  writeFileSync(local.runPath, '损坏记录');
  local.inspect(db => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_schema').get().n, 0));

  const first = await local.start();
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:[1-9]\d*$/);
  assert.equal(statSync(local.runPath).mode & 0o777, 0o600);
  assert.ok(Number.isFinite(Date.parse(first.startedAt)));
  assert.ok(first.token);
  assert.ok(first.stdout.includes(local.data));
  assert.match(first.stdout, /admin.*student.*student2.*123456/);
  await assert.rejects(local.command(['start']), failure(new RegExp(`${first.pid}.*127\\.0\\.0\\.1`)));

  for (const [username, displayName, role] of [
    ['admin', '王教务', 'admin'], ['student', '李小明', 'student'], ['student2', '陈小红', 'student'],
  ]) {
    const response = await login(first.url, username);
    assert.equal(response.status, 200);
    const { user } = await response.json();
    assert.deepEqual([user.username, user.displayName, user.role], [username, displayName, role]);
  }
  await delay(25);
  process.kill(first.pid, 'SIGINT');
  assert.deepEqual(await first.exited, [0, null]);
  assert.equal(existsSync(local.runPath), false);
  const settings = local.inspect(db => {
    assert.deepEqual(db.prepare('SELECT video_file, duration_seconds, published FROM courses ORDER BY id').all()
      .map(row => Object.values(row)), courseVideos);
    assert.deepEqual(db.prepare('SELECT title, summary, description, instructor, level, video_file, duration_seconds FROM courses ORDER BY id')
      .all().map(row => Object.values(row)), expectedExamples);
    const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    assert.ok(rows.length >= 2);
    assert.ok(rows.some(row => /^[0-9a-f]{64,}$/i.test(row.value)));
    db.exec("UPDATE courses SET title = '保留已修改的课程', instructor = '本地讲师', level = 'advanced', summary = '本地简介', description = '本地正文' WHERE id = 1");
    return rows;
  });

  const second = await local.start();
  process.kill(second.pid, 'SIGKILL');
  await second.exited;
  assert.equal(existsSync(local.runPath), true);
  const third = await local.start();
  const pending = createConnection({ host: '127.0.0.1', port: Number(new URL(third.url).port) });
  t.after(() => pending.destroy());
  await once(pending, 'connect');
  const closed = once(pending, 'close');
  pending.write('POST /api/login HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
    'Content-Type: application/json\r\nContent-Length: 200\r\n\r\n{');
  await delay(30);
  const stoppingAt = performance.now();
  process.kill(third.pid, 'SIGTERM');
  assert.deepEqual(await third.exited, [0, null]);
  await closed;
  const drainTime = performance.now() - stoppingAt;
  assert.ok(drainTime >= 1500 && drainTime <= 3200, `结束未完成请求耗时 ${drainTime} ms`);
  assert.equal(existsSync(local.runPath), false);
  local.inspect(db => {
    assert.deepEqual(db.prepare('SELECT key, value FROM settings ORDER BY key').all(), settings);
    assert.deepEqual(Object.values(db.prepare('SELECT title, instructor, level, summary, description FROM courses WHERE id = 1').get()),
      ['保留已修改的课程', '本地讲师', 'advanced', '本地简介', '本地正文']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
  });
});

test('operations-20：迁移历史、数据库约束和逐文件提交', async t => {
  const local = fixture(t);
  assert.match((await local.command(['run', 'migrate'])).stdout, /已执行迁移.*001-init.sql/);
  const migrationDir = join(local.cwd, 'migrations');
  const historyPath = join(migrationDir, '001-init.sql');
  const initial = readFileSync(historyPath, 'utf8');
  const nextPath = join(migrationDir, '002-instructor-note.sql');
  const failurePath = join(migrationDir, '003-failing.sql');
  const laterPath = join(migrationDir, '004-later.sql');
  local.inspect(db => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  });

  const running = await local.start();
  const health = async () => {
    const response = await fetch(running.url + '/api/health');
    assert.equal(response.status, 200);
    return (await response.json()).migrations;
  };
  assert.deepEqual(await health(), { applied: ['001-init.sql'], pending: [] });
  writeFileSync(nextPath, "ALTER TABLE courses ADD COLUMN instructor_note TEXT NOT NULL DEFAULT '既有课程';");
  assert.deepEqual(await health(), { applied: ['001-init.sql'], pending: ['002-instructor-note.sql'] });
  await assert.rejects(local.command(['run', 'migrate']), failure(/已由进程/));
  assert.equal((await login(running.url)).status, 200);
  process.kill(running.pid, 'SIGTERM');
  await running.exited;

  local.inspect(db => {
    assert.throws(() => db.exec("UPDATE users SET role = 'unknown'"));
    assert.throws(() => db.exec("UPDATE users SET username = 'admin'"));
    assert.throws(() => db.exec('UPDATE courses SET duration_seconds = -1'));
    assert.throws(() => db.exec('UPDATE courses SET published = 2'));
    assert.throws(() => db.exec("UPDATE courses SET level = 'unknown'"));
    assert.throws(() => db.exec("INSERT INTO sessions VALUES ('ghost', 9999, 0)"));
    db.exec("DELETE FROM users WHERE username = 'admin'");
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  });
  await assert.rejects(local.command(['start']), failure(/002-instructor-note.sql.*backup.*migrate.*start/));

  writeFileSync(failurePath, 'CREATE TABLE must_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);');
  writeFileSync(laterPath, 'CREATE TABLE later (id INTEGER);');
  await assert.rejects(local.command(['run', 'migrate']), failure(/003-failing.sql/));
  local.inspect(db => {
    assert.deepEqual(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(row => row.name),
      ['001-init.sql', '002-instructor-note.sql']);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('must_rollback', 'later')").all(), []);
    const course = db.prepare('SELECT instructor_note, created_at, updated_at FROM courses WHERE id = 1').get();
    assert.equal(course.instructor_note, '既有课程');
    assert.ok(course.created_at > 1_000_000_000_000 && course.updated_at >= course.created_at);
  });

  writeFileSync(historyPath, initial + '\n-- 修改已执行文件\n');
  await assert.rejects(local.command(['run', 'migrate']), failure(/迁移历史冲突.*001-init.sql/));
  writeFileSync(historyPath, initial);
  const renamed = join(migrationDir, '001-renamed.sql');
  renameSync(historyPath, renamed);
  await assert.rejects(local.command(['start']), failure(/迁移历史冲突/));
  renameSync(renamed, historyPath);
  const inserted = join(migrationDir, '000-inserted.sql');
  writeFileSync(inserted, 'SELECT 1;');
  await assert.rejects(local.command(['run', 'migrate']), failure(/迁移历史冲突/));
  rmSync(inserted);

  const duplicate = join(migrationDir, '002-duplicate.sql');
  writeFileSync(duplicate, 'SELECT 1;');
  await assert.rejects(local.command(['run', 'migrate']), failure(/迁移编号重复/));
  rmSync(duplicate);
  const invalid = join(migrationDir, '005-Invalid.sql');
  writeFileSync(invalid, 'SELECT 1;');
  await assert.rejects(local.command(['run', 'migrate']), failure(/迁移文件名无效/));
  rmSync(invalid);
  writeFileSync(failurePath, 'CREATE TABLE recovered (id INTEGER);');
  assert.match((await local.command(['run', 'migrate'])).stdout, /003-failing.sql.*004-later.sql/);
  assert.match((await local.command(['run', 'migrate'])).stdout, /无需迁移/);
});

test('operations-21：维护令牌、备份锁定与恢复真实数据库', async t => {
  const local = fixture(t);
  await assert.rejects(local.command(['run', 'backup']), failure(/数据库不存在/));
  const first = await local.start();
  const stopUrl = first.url + '/internal/stop';
  for (const headers of [{}, { 'x-maintenance-token': 'invalid-token' }]) {
    assert.equal((await fetch(stopUrl, { method: 'POST', headers })).status, 403);
  }
  const response = await fetch(stopUrl, { method: 'POST', headers: { 'x-maintenance-token': first.token } });
  assert.equal(response.status, 202);
  assert.match(await response.text(), /[\u4e00-\u9fa5]/);
  await first.exited;
  assert.equal(existsSync(local.runPath), false);

  const clock = join(local.cwd, 'fixed-clock.mjs');
  writeFileSync(clock, `const SystemDate = Date;
    globalThis.Date = class extends SystemDate {
      constructor(...args) { super(...(args.length ? args : ['2030-01-02T03:04:05Z'])); }
    };
  `);
  const frozen = { NODE_OPTIONS: `--import=${clock}`, TZ: 'UTC' };
  const running = await local.start();
  const saved = await local.command(['run', 'backup'], frozen);
  await running.exited;
  assert.equal(existsSync(local.runPath), false);
  assert.match(saved.stdout, /账号 3，课程 4，迁移 1/);
  assert.ok(saved.stdout.includes(`PORT=${new URL(running.url).port} npm start`));
  const [firstFile] = readdirSync(local.backupDir);
  assert.equal(firstFile, 'academy-local-data-20300102-030405.sqlite');
  const snapshot = join(local.backupDir, firstFile);
  const snapshotBefore = readFileSync(snapshot);
  await local.command(['run', 'backup'], frozen);
  assert.deepEqual(readdirSync(local.backupDir).sort(),
    ['academy-local-data-20300102-030405-1.sqlite', 'academy-local-data-20300102-030405.sqlite']);
  assert.deepEqual(readFileSync(snapshot), snapshotBefore);

  const active = await local.start();
  await assert.rejects(local.command(['run', 'restore', '--', snapshot]), failure(/已由进程/));
  process.kill(active.pid, 'SIGTERM');
  await active.exited;
  assert.equal(existsSync(local.runPath), false);

  const original = local.inspect(db => {
    const title = db.prepare('SELECT title FROM courses WHERE id = 1').get().title;
    db.exec("UPDATE courses SET title = '恢复前的课程' WHERE id = 1");
    return title;
  });
  const invalid = join(local.cwd, 'invalid.sqlite');
  local.inspect(db => db.exec('CREATE TABLE irrelevant (id INTEGER);'), invalid);
  await assert.rejects(local.command(['run', 'restore', '--', 'absent.sqlite']), failure(/不存在/));
  await assert.rejects(local.command(['run', 'restore', '--', basename(local.backupDir)]), failure(/普通文件/));
  await assert.rejects(local.command(['run', 'restore', '--', local.dbPath]), failure(/当前数据库/));
  await assert.rejects(local.command(['run', 'restore', '--', invalid]), failure(/缺少必要的表/));
  assert.equal(local.inspect(db => db.prepare('SELECT title FROM courses WHERE id = 1').get().title), '恢复前的课程');

  writeFileSync(join(local.cwd, 'migrations', '002-after-backup.sql'), 'SELECT 1;');
  const restored = await local.command(['run', 'restore', '--', join(basename(local.backupDir), firstFile)]);
  assert.match(restored.stdout, /已恢复.*academy\.sqlite/);
  assert.match(restored.stdout, /有待执行的迁移：002-after-backup.sql/);
  assert.equal(existsSync(local.runPath), false);
  const before = readdirSync(local.backupDir).find(file => file.startsWith('before-restore-'));
  assert.match(before, /^before-restore-local-data-\d{8}-\d{6}\.sqlite$/);
  assert.ok(restored.stdout.includes(join(local.backupDir, before)));
  assert.equal(local.inspect(db => db.prepare('SELECT title FROM courses WHERE id = 1').get().title), original);
  assert.equal(local.inspect(db => db.prepare('SELECT title FROM courses WHERE id = 1').get().title,
    join(local.backupDir, before)), '恢复前的课程');
  for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(local.dbPath + suffix), false);
});

test('operations-21：恢复损坏的数据库并逐字节留存原文件', async t => {
  const local = fixture(t);
  const running = await local.start();
  await local.command(['run', 'backup']);
  await running.exited;
  const [file] = readdirSync(local.backupDir);
  const snapshot = join(local.backupDir, file);
  const courses = path => local.inspect(db => db.prepare('SELECT * FROM courses ORDER BY id').all(), path);
  const expected = courses(snapshot);

  const damaged = Buffer.concat([Buffer.from('损坏的数据库'), Buffer.from([0, 255, 128])]);
  writeFileSync(local.dbPath, damaged);
  for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(local.dbPath + suffix, '旧日志');

  const blocked = join(local.cwd, 'blocked-backups');
  writeFileSync(blocked, '不是目录');
  await assert.rejects(local.command(['run', 'restore', '--', snapshot], { BACKUP_DIR: blocked }), failure(/blocked-backups/));
  assert.deepEqual(readFileSync(local.dbPath), damaged);
  for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(readFileSync(local.dbPath + suffix, 'utf8'), '旧日志');
  assert.equal(existsSync(local.runPath), false);

  const restored = await local.command(['run', 'restore', '--', snapshot]);
  const before = readdirSync(local.backupDir).find(name => name.startsWith('before-restore-'));
  assert.match(before, /^before-restore-local-data-\d{8}-\d{6}\.sqlite$/);
  const preserved = join(local.backupDir, before);
  assert.ok(restored.stdout.includes(preserved));
  assert.match(restored.stdout, /账号 3，课程 4，迁移 1/);
  assert.deepEqual(readFileSync(preserved), damaged);
  for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(local.dbPath + suffix), false);
  assert.deepEqual(courses(local.dbPath), expected);
  assert.equal(existsSync(local.runPath), false);
});

const ffmpegEncoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const pillowReady = spawnSync('python3', ['-c', 'from PIL import ImageFont; ImageFont.load_default(size=20)'], { stdio: 'ignore' });
const mediaToolsReady = ffmpegEncoders.status === 0 && /\blibx264\b/.test(ffmpegEncoders.stdout) && pillowReady.status === 0;

test('operations-22：生成的示例素材可解码并与课程一致', {
  timeout: 90_000,
  skip: mediaToolsReady ? false : '此验证需要含 libx264 的 ffmpeg 和支持可缩放默认字体的 Python Pillow。',
}, async t => {
  const local = fixture(t);
  await execute('./scripts/make-media.sh', [], { cwd: local.cwd, timeout: 80_000 });
  const service = await local.start();
  const auth = await login(service.url);
  assert.equal(auth.status, 200);
  const headers = { cookie: auth.headers.get('set-cookie').split(';')[0] };
  const videoResponse = await fetch(service.url + '/api/admin/videos', { headers });
  assert.equal(videoResponse.status, 200);
  const { videos } = await videoResponse.json();
  assert.deepEqual(videos.map(video => [video.file, video.durationSeconds]),
    courseVideos.map(([name, length]) => [name, length]).sort());
  for (const video of videos) {
    assert.ok(video.sizeBytes > 0);
    const file = join(local.cwd, 'media', video.file);
    await execute('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-']);
  }
  const courseResponse = await fetch(service.url + '/api/admin/courses', { headers });
  assert.equal(courseResponse.status, 200);
  const { courses } = await courseResponse.json();
  assert.deepEqual(courses.map(course => [course.videoFile, course.durationSeconds, +course.published]), courseVideos);
  process.kill(service.pid, 'SIGTERM');
  await service.exited;
});
