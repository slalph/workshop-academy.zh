// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeHandler, seed } from '../src/app.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let directory;
let mediaRoot;
let db;
let server;
let port;
let stopCalls = 0;

const header = Buffer.alloc(36);
header.writeUInt32BE(36, 0);
header.write('moov', 4);
header.writeUInt32BE(28, 8);
header.write('mvhd', 12);
header.writeUInt32BE(1000, 28);
header.writeUInt32BE(18_600, 32);
const password = '123456';

before(async () => {
  directory = await mkdtemp(join(root, '.domain-test-'));
  mediaRoot = join(directory, 'media');
  await mkdir(mediaRoot);
  await writeFile(join(mediaRoot, 'python-basics.mp4'), header);
  await writeFile(join(mediaRoot, 'other.mp4'), 'hello');
  await writeFile(join(mediaRoot, 'IGNORED.mp4'), 'hello');
  await mkdir(join(mediaRoot, 'directory.mp4'));
  db = new DatabaseSync(':memory:');
  const migration = await readFile(join(root, 'migrations', '001-init.sql'), 'utf8');
  db.exec(migration);
  seed(db);
  seed(db);
  server = createServer(makeHandler({
    db,
    mediaRoot,
    migrations: () => ({ applied: ['001-init.sql'], pending: [] }),
    stopToken: 'test-maintenance',
    stop: () => { stopCalls += 1; },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function http(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const bytes = Buffer.concat(data);
        resolve({ status: res.statusCode, headers: res.headers, bytes, text: bytes.toString(), json: () => JSON.parse(bytes) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function api(path, method, input, headers = {}) {
  return http(path, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(input),
  });
}

async function login(username, oldCookie) {
  const response = await api('/api/login', 'POST', { username, password }, oldCookie ? { Cookie: oldCookie } : {});
  assert.equal(response.status, 200);
  const raw = response.headers['set-cookie'][0];
  assert.match(raw, /^academy_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  return { cookie: raw.split(';')[0], user: response.json().user };
}

test('HTTP validation, error representation, HEAD, asset caching, and maintenance token', async () => {
  for (const host of ['LOCALHOST:123', '127.0.0.1', '[::1]:42']) {
    assert.equal((await http('/api/health', { headers: { Host: host } })).status, 200);
  }
  const invalidHost = await http('/api/health', { headers: { Host: 'example.test' } });
  assert.equal(invalidHost.status, 400);
  assert.match(invalidHost.json().error, /[一-龥]/);
  assert.deepEqual((await http('/api/health')).json(), { ok: true, migrations: { applied: ['001-init.sql'], pending: [] } });
  assert.equal((await api('/api/logout', 'POST', {}, { Origin: 'https://localhost' })).status, 403);
  assert.equal((await api('/api/logout', 'POST', {}, { Host: 'LOCALHOST:1', Origin: 'http://LOCALHOST:1' })).status, 200);
  assert.equal((await http('/api/logout', { method: 'POST' })).status, 415);
  for (const body of ['[1]', 'null', '42', 'false', '"x"', '{', '\u00a0{}']) {
    assert.equal((await http('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400);
  }
  assert.equal((await http('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' \t\n' })).status, 200);
  assert.equal((await http('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(65_537) })).status, 413);
  assert.equal((await http('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, body: ' '.repeat(65_537) })).status, 413);
  assert.equal((await http('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(65_536) })).status, 200);
  const wrongMethod = await api('/api/session', 'PATCH', {});
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'GET, HEAD');
  const head = await http('/api/session', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.equal(head.headers['cache-control'], 'no-store');
  assert.equal(head.headers['x-content-type-options'], 'nosniff');
  assert.equal(head.headers['referrer-policy'], 'no-referrer');
  assert.equal(head.headers['x-frame-options'], 'DENY');
  assert.equal(head.headers['cross-origin-opener-policy'], 'same-origin');
  assert.match(head.headers['content-security-policy'], /form-action 'self'/);
  const html = await http('/unknown');
  assert.equal(html.status, 404);
  assert.match(html.text, /lang="zh-CN"/i);
  const icon = await http('/favicon.ico');
  assert.equal(icon.status, 301);
  assert.equal(icon.headers.location, '/assets/favicon.svg');
  const asset = await http('/assets/academy.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers['cache-control'], 'public, no-cache');
  assert.ok(asset.headers['last-modified']);
  assert.match(asset.headers.etag, /^W\//);
  assert.equal((await http('/assets/academy.js', { headers: { 'If-None-Match': asset.headers.etag } })).status, 304);
  for (const path of ['/assets/../package.json', '/assets/%2e%2e/package.json', '/assets/%ZZ.js', '/assets//academy.js', '/assets/academy%00.js']) {
    assert.equal((await http(path)).status, 404);
  }
  assert.equal((await http('/internal/stop', { method: 'POST' })).status, 403);
  assert.equal((await http('/internal/stop', { method: 'POST', headers: { 'X-Maintenance-Token': 'test-maintenance' } })).status, 202);
  assert.equal(stopCalls, 1);
});

test('login, session expiry, account replacement and access gates', async () => {
  for (const [path, status] of [['/admin?tab=all', 302], ['/admin/courses/new', 302], ['/admin/courses/4/edit', 302], ['/api/admin/courses', 401], ['/api/admin/courses/4', 401], ['/api/admin/videos', 401]]) {
    const response = await http(path);
    assert.equal(response.status, status);
    if (status === 302) assert.equal(new URL(response.headers.location, 'http://localhost').searchParams.get('next'), path);
  }
  assert.deepEqual((await http('/api/session')).json(), { user: null });
  const missing = await api('/api/login', 'POST', { username: ' ', password: 42 });
  assert.equal(missing.status, 400);
  assert.deepEqual(Object.keys(missing.json().fields).sort(), ['password', 'username']);
  const bad = await api('/api/login', 'POST', { username: 'admin', password: '4321' });
  const unknown = await api('/api/login', 'POST', { username: 'unknown', password });
  const long = await api('/api/login', 'POST', { username: ' '.repeat(65) + 'admin', password });
  for (const response of [bad, unknown, long]) {
    assert.equal(response.status, 401);
    assert.equal(response.text, bad.text);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('expired', 1, Date.now() - 1);
  const student = await login(' student ');
  assert.deepEqual(student.user, { id: 2, username: 'student', displayName: '李小明', role: 'student' });
  assert.equal(db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get('expired'), undefined);
  const token = student.cookie.slice('academy_session='.length);
  const hash = createHash('sha256').update(token).digest('hex');
  const stored = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
  assert.ok(stored.expires_at - Date.now() <= 43_200_000 && stored.expires_at - Date.now() > 43_190_000);
  assert.equal(db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(token), undefined);
  const accounts = db.prepare('SELECT password_salt, password_hash FROM users').all();
  assert.equal(new Set(accounts.map(account => account.password_salt)).size, 3);
  assert.equal(new Set(accounts.map(account => account.password_hash)).size, 3);
  const studentHeaders = { Cookie: student.cookie };
  for (const path of ['/admin', '/admin/courses/new', '/admin/courses/4/edit', '/api/admin/courses', '/api/admin/courses/4', '/api/admin/videos']) {
    assert.equal((await http(path, { headers: studentHeaders })).status, 403);
  }
  assert.deepEqual((await http('/api/session', { headers: studentHeaders })).json(), { user: student.user });
  assert.equal((await http('/login?next=%2Fcourses%2F1%3Fx%3D1', { headers: studentHeaders })).headers.location, '/courses/1?x=1');
  for (const next of ['//example.test', 'https://example.test', '/api/courses', '/login?switch=1', '/\\example.test', '/a/..//example.test']) {
    assert.equal((await http('/login?next=' + encodeURIComponent(next), { headers: studentHeaders })).headers.location, '/');
  }
  assert.equal((await http('/login?switch=1', { headers: studentHeaders })).status, 200);
  const admin = await login('admin', student.cookie);
  assert.equal((await http('/api/session', { headers: studentHeaders })).json().user, null);
  const headers = { Cookie: admin.cookie };
  assert.equal((await http('/api/session', { headers })).json().user.role, 'admin');
  assert.equal((await http('/admin/courses/4/edit', { headers })).status, 200);
  assert.equal((await http('/admin/courses/04/edit', { headers })).status, 404);
  const logout = await api('/api/logout', 'POST', {}, headers);
  assert.deepEqual(logout.json(), { ok: true });
  assert.match(logout.headers['set-cookie'][0], /^academy_session=; .*Max-Age=0$/);
  assert.equal((await http('/api/session', { headers })).json().user, null);
});

test('course catalog and management preserve public shape, validate writes, and derive video metadata', async () => {
  const response = await http('/api/courses');
  const publicCourses = response.json().courses;
  assert.deepEqual(publicCourses.map(course => course.id), [1, 2, 3]);
  assert.deepEqual(Object.keys(publicCourses[0]).sort(), ['coverUrl', 'description', 'durationSeconds', 'id', 'instructor', 'level', 'levelLabel', 'published', 'summary', 'title', 'updatedAt', 'url']);
  assert.equal(publicCourses[0].published, true);
  assert.equal(publicCourses[0].levelLabel, '入门');
  assert.equal(publicCourses[0].url, '/courses/1');
  assert.equal(publicCourses[0].coverUrl, '/covers/1.svg');
  for (const id of ['0', '01', '-1', '1e2', '9007199254740992', '4', '999']) {
    assert.equal((await http('/api/courses/' + id)).status, 404);
    assert.equal((await http('/courses/' + id)).status, 404);
  }
  assert.equal((await http('/courses/1')).status, 200);
  const cover = await http('/covers/1.svg');
  assert.equal(cover.status, 200);
  assert.equal(cover.headers['content-type'], 'image/svg+xml');
  assert.equal(cover.headers['cache-control'], 'public, max-age=3600');
  assert.equal(cover.text, (await http('/covers/1.svg')).text);
  assert.notEqual(cover.text, (await http('/covers/999.svg')).text);

  const { cookie } = await login('admin');
  const headers = { Cookie: cookie };
  const courses = (await http('/api/admin/courses', { headers })).json().courses;
  assert.deepEqual(courses.map(course => course.id), [1, 2, 3, 4]);
  assert.equal(courses[3].published, false);
  assert.equal(courses[3].videoFile, 'sqlite-modeling.mp4');
  assert.equal(typeof courses[3].createdAt, 'number');
  assert.equal((await http('/api/admin/courses/04', { headers })).status, 404);
  assert.deepEqual((await http('/api/admin/courses/4', { headers })).json().course, courses[3]);
  const videos = (await http('/api/admin/videos', { headers })).json().videos;
  assert.deepEqual(videos, [
    { file: 'other.mp4', sizeBytes: 5, durationSeconds: null },
    { file: 'python-basics.mp4', sizeBytes: header.length, durationSeconds: 19 },
  ]);
  const fields = await api('/api/admin/courses', 'POST', {
    title: '🟢'.repeat(81), summary: ' ', description: 'x'.repeat(5001), instructor: '', level: 'toString',
    videoFile: 'missing.mp4', published: 0,
  }, headers);
  assert.equal(fields.status, 400);
  assert.deepEqual(Object.keys(fields.json().fields).sort(), ['description', 'instructor', 'level', 'published', 'summary', 'title', 'videoFile']);
  assert.equal((await api('/api/admin/courses', 'POST', { durationSeconds: 1 }, headers)).status, 400);
  const created = await api('/api/admin/courses', 'POST', {
    title: ' 🟢'.trim() + '🟢'.repeat(79), summary: '  课程\r\n摘要\r  ', instructor: '测试者',
    level: 'advanced', videoFile: 'python-basics.mp4',
  }, headers);
  assert.equal(created.status, 201);
  const course = created.json().course;
  assert.equal(course.published, false);
  assert.equal(course.description, '');
  assert.equal(course.summary, '课程\n摘要');
  assert.equal(course.durationSeconds, 19);
  assert.equal(course.updatedAt, course.createdAt);
  assert.equal((await api('/api/admin/courses/' + course.id, 'PATCH', {}, headers)).status, 400);
  const update = (await api('/api/admin/courses/' + course.id, 'PATCH', { videoFile: 'other.mp4', published: true }, headers)).json().course;
  assert.equal(update.durationSeconds, 0);
  assert.equal(update.title, course.title);
  assert.equal(update.createdAt, course.createdAt);
  assert.ok(update.updatedAt > course.updatedAt);
  assert.equal((await http('/api/courses/' + course.id)).json().course.published, true);
  db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
});

test('course-access-18：课程页面与签发入口的资格矩阵', async () => {
  const { cookie: student } = await login('student');
  const { cookie: admin } = await login('admin');
  for (const Cookie of [undefined, student, admin]) {
    const headers = Cookie ? { Cookie } : {};
    for (const [id, publicStatus, signedInIssue] of [[1, 200, 200], [4, 404, 404], [999, 404, 404], ['01', 404, 404]]) {
      const page = await http(`/courses/${id}`, { headers });
      assert.equal(page.status, publicStatus);
      assert.equal(page.text.includes('开始观看'), Boolean(Cookie && publicStatus === 200));
      assert.equal(page.text.includes('登录后观看'), Boolean(!Cookie && publicStatus === 200));
      assert.doesNotMatch(page.text, /\/media\/\d+\?/);
      const issued = await api(`/api/courses/${id}/play`, 'POST', {}, headers);
      assert.equal(issued.status, Cookie || id === '01' ? signedInIssue : 401);
      assert.equal('url' in issued.json(), Boolean(Cookie && signedInIssue === 200));
    }
  }
});

test('signed playback eligibility, expiry, byte serving, and media isolation', async () => {
  const play = (id, headers) => api(`/api/courses/${id}/play`, 'POST', {}, headers);
  assert.equal((await play('01')).status, 404);
  assert.equal((await play(1)).status, 401);
  const { cookie } = await login('admin');
  const headers = { Cookie: cookie };
  assert.equal((await play(4, headers)).status, 404);
  assert.equal((await play(999, headers)).status, 404);
  const guestPage = await http('/courses/1');
  const signedInPage = await http('/courses/1', { headers });
  assert.match(guestPage.text, /\/login\?next=/);
  assert.match(signedInPage.text, /开始观看/);
  for (const page of [guestPage, signedInPage]) assert.doesNotMatch(page.text, /\/media\/1\?/);
  const issued = await play(1, headers);
  assert.equal(issued.status, 200);
  const { url, expiresAt } = issued.json();
  assert.ok(expiresAt > Date.now() + 59_000 && expiresAt <= Date.now() + 60_000);
  const whole = await http(url);
  assert.deepEqual(whole.bytes, header);
  assert.equal(whole.headers['content-type'], 'video/mp4');
  assert.equal(whole.headers['accept-ranges'], 'bytes');
  for (const [range, status, start, end] of [
    ['bytes=0-3', 206, 0, 3], ['bytes=34-', 206, 34, 35], ['bytes=-2', 206, 34, 35],
    ['bytes=35-999', 206, 35, 35], ['bytes=-999', 206, 0, 35],
    ['bytes=7-6', 200, 0, 35], ['bytes=no', 200, 0, 35], ['bytes=0-1,3-4', 200, 0, 35],
  ]) {
    const options = { headers: { Range: range } };
    const result = await http(url, options);
    assert.equal(result.status, status);
    assert.equal(result.headers['content-length'], String(end - start + 1));
    assert.deepEqual(result.bytes, header.subarray(start, end + 1));
    if (status === 206) assert.equal(result.headers['content-range'], `bytes ${start}-${end}/36`);
    const head = await http(url, { method: 'HEAD', ...options });
    assert.equal(head.status, status);
    assert.equal(head.bytes.length, 0);
    assert.equal(head.headers['content-length'], result.headers['content-length']);
    assert.equal(head.headers['content-range'], result.headers['content-range']);
  }
  for (const Range of ['bytes=36-', 'bytes=-0', 'bytes=900719925474099400-']) {
    const result = await http(url, { headers: { Range } });
    assert.equal(result.status, 416);
    assert.equal(result.headers['content-range'], 'bytes */36');
  }
  db.prepare('UPDATE courses SET published = 0 WHERE id = 1').run();
  assert.equal((await play(1, headers)).status, 404);
  assert.equal((await http(url)).status, 200);
  db.prepare("UPDATE courses SET video_file = 'other.mp4' WHERE id = 1").run();
  assert.equal((await http(url)).text, 'hello');
  db.prepare("UPDATE courses SET video_file = 'missing.mp4' WHERE id = 1").run();
  assert.equal((await http(url)).status, 404);
  db.prepare("UPDATE courses SET video_file = 'python-basics.mp4', published = 1 WHERE id = 1").run();

  assert.equal((await http(url.replace('/media/1', '/media/2'))).status, 403);
  assert.equal((await http(url.replace('/media/1', '/media/01'))).status, 404);
  assert.equal((await http(url.replace(String(expiresAt), String(expiresAt + 1)))).status, 403);
  assert.equal((await http(url.replace(/signature=.*/, 'signature=' + '0'.repeat(64)))).status, 403);
  assert.equal((await http(url.split('&')[0])).status, 403);
  const expires = Date.now() - 1;
  const secret = db.prepare("SELECT value FROM settings WHERE key = 'playback_key'").get().value;
  const signature = createHmac('sha256', Buffer.from(secret, 'hex')).update(`1:${expires}`).digest('hex');
  assert.equal((await http(`/media/1?expires=${expires}&signature=${signature}`)).status, 410);
  assert.equal((await http(`/media/2?expires=${expires}&signature=${signature}`)).status, 403);
  for (const path of ['/media/python-basics.mp4', '/python-basics.mp4', '/assets/../media/python-basics.mp4']) {
    const direct = await http(path);
    assert.equal(direct.status, 404);
    assert.notEqual(direct.headers['content-type'], 'video/mp4');
  }
  await rm(mediaRoot, { recursive: true });
  assert.deepEqual((await http('/api/admin/videos', { headers })).json().videos, []);
});
