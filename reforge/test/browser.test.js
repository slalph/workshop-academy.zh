// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { makeHandler, seed } from '../src/app.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const chromium = process.env.CHROMIUM_PATH || 'chromium';
const browserAvailable = spawnSync(chromium, ['--version'], { stdio: 'ignore' }).status === 0;

async function openBrowser(t, directory) {
  const child = spawn(chromium, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--remote-debugging-pipe', '--user-data-dir=' + join(directory, 'profile'), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'exit');
  const pending = new Map();
  let lastId = 0;
  let buffered = '';
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    const messages = (buffered + chunk).split('\0');
    buffered = messages.pop();
    for (const message of messages) {
      const { id, result, error } = JSON.parse(message);
      const request = pending.get(id);
      if (!request) continue;
      pending.delete(id);
      if (error) request.reject(new Error(error.message));
      else request.resolve(result);
    }
  });
  child.once('exit', () => {
    for (const { reject } of pending.values()) reject(new Error('Chromium 已退出。'));
    pending.clear();
  });
  t.after(async () => {
    child.kill('SIGKILL');
    await ended;
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, { resolve, reject });
    child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const { result, exceptionDetails } = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  return { evaluate, command };
}

test('catalog-8 / course-admin-15：桌面和窄屏目录及课程管理浏览器流程', {
  skip: browserAvailable ? false : '此验证需要 Chromium，可用 CHROMIUM_PATH 指定。', timeout: 30_000,
}, async t => {
  const directory = await mkdtemp(join(root, '.browser-test-'));
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(join(root, 'migrations/001-init.sql'), 'utf8'));
  seed(db);
  const mediaRoot = join(directory, 'media');
  await mkdir(mediaRoot);
  await writeFile(join(mediaRoot, 'example.mp4'), 'example');
  const server = createServer(makeHandler({ db, mediaRoot }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });

  const { evaluate, command } = await openBrowser(t, directory);

  async function waitFor(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression).catch(() => false)) return;
      await delay(35);
    }
    assert.fail('浏览器未出现预期状态 ' + expression);
  }
  const go = async (path, expression) => {
    await command('Page.navigate', { url: address + path });
    await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && (${expression})`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (id, value) => evaluate(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`);
  const feedback = selector => `document.querySelector(${JSON.stringify(selector)}).textContent`;

  for (const width of [1200, 360]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await go('/', 'document.querySelectorAll(".course-card").length === 3');
    assert.equal(await evaluate('document.querySelector("h1").textContent'), '学堂在线');
    assert.equal(await evaluate('document.querySelector(".hero-copy > p").textContent'), '边看边做，把想法变成作品。');
    assert.match(await evaluate(feedback('.catalog-totals')), /3 门课程.*总时长 1 分 0 秒/);
    assert.ok(await evaluate('document.querySelector(".catalog-totals").getBoundingClientRect().bottom < innerHeight'));
    assert.ok(await evaluate('document.documentElement.scrollWidth === document.documentElement.clientWidth'));
    assert.ok(await evaluate('document.querySelector(".hero-art").naturalWidth > 0'));
    assert.equal(await evaluate('document.querySelector(".hero .button").hash'), '#courses');
    assert.ok(await evaluate(`document.querySelector('.hero a[href="/login"]') !== null`));
    await click('.course-card');
    await waitFor('location.pathname === "/courses/1" && !!document.querySelector("[data-poster]")');
    assert.ok(await evaluate('document.documentElement.scrollWidth === document.documentElement.clientWidth'));
    assert.equal(await evaluate('document.querySelectorAll(".description p").length'), 3);
    assert.match(await evaluate(feedback('.course-facts')), /林知远[\s\S]*18 秒[\s\S]*更新日期/);
    assert.ok(await evaluate('document.querySelector(".watch-actions a").href.includes("/login?next=")'));
  }

  await go('/login', '!!document.querySelector("[data-demo=admin]")');
  await click('[data-demo=admin]');
  await waitFor('!!document.querySelector("#logout")');
  await go('/admin', 'document.querySelectorAll(".management-row").length === 4');
  assert.equal(await evaluate(feedback('[data-count="all"]')), '4');
  assert.equal(await evaluate(feedback('[data-count="published"]')), '3');
  assert.equal(await evaluate(feedback('[data-count="draft"]')), '1');
  assert.match(await evaluate(feedback('[data-course-id="1"]')), /python-basics\.mp4/);
  await click('a[href="/admin/courses/1/edit"]');
  await waitFor(`${feedback('#video-feedback')}.includes("原视频文件缺失")`);
  await click('#course-form a[href="/admin"]');
  await waitFor('location.pathname === "/admin" && !!document.querySelector(".management-list")');

  await click('a[href="/admin/courses/new"]');
  await waitFor('!!document.querySelector("#course-form") && document.querySelector("#videoFile").options.length === 2');
  assert.match(await evaluate('document.querySelector("#videoFile").options[1].textContent'), /example\.mp4.*时长未知.*7 字节/);
  await click('#course-form [type=submit]');
  assert.equal(await evaluate('document.activeElement.id'), 'title');
  const title = '<课程 & 练习>';
  await fill('title', '🟢'.repeat(81));
  await fill('summary', '<一句话简介>');
  await fill('description', '<第一段>\n\n第二段 & 正文');
  await fill('instructor', '课程讲师');
  await fill('level', 'advanced');
  await fill('videoFile', 'example.mp4');
  await click('#course-form [type=submit]');
  await waitFor(`${feedback('#title-error')}.includes("80")`);
  assert.equal(await evaluate('document.activeElement.id'), 'title');
  await fill('title', title);
  await click('#course-form [type=submit]');
  await waitFor(`location.pathname === "/admin" && !!document.querySelector('[data-course-id="5"]')`);
  assert.match(await evaluate(feedback('#admin-feedback')), /已创建课程「<课程 & 练习>」。.*草稿.*公开目录/);

  await click('a[href="/admin/courses/5/edit"]');
  await waitFor('!!document.querySelector("#course-form")');
  assert.equal(await evaluate('document.querySelector(".editor header a") === null'), true);
  await click('#published');
  await click('#course-form [type=submit]');
  await waitFor(`location.pathname === "/admin" && ${feedback('#admin-feedback')}.includes("已更新")`);
  assert.match(await evaluate(feedback('#admin-feedback')), /<课程 & 练习>.*已发布.*公开目录/);

  await click('a[href="/admin/courses/5/edit"]');
  await waitFor('!!document.querySelector(".editor header a")');
  await click('.editor header a');
  await waitFor('location.pathname === "/courses/5" && document.querySelectorAll(".description p").length === 2');
  assert.equal(await evaluate(feedback('h1')), title);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".description p")].map(p => p.textContent)'), ['<第一段>', '第二段 & 正文']);
  await evaluate('history.back()');
  await waitFor('location.pathname === "/admin/courses/5/edit" && !!document.querySelector("#course-form")');
  await fill('title', '不保存');
  await click('#course-form a[href="/admin"]');
  await waitFor('location.pathname === "/admin" && !!document.querySelector("#admin-feedback")');
  assert.equal((await (await fetch(address + '/api/courses/5')).json()).course.title, title);
  await evaluate(`window.savedFetch = window.fetch;
    window.fetch = (...args) => args[1]?.method === 'PATCH' ?
      Promise.resolve(new Response(JSON.stringify({ error: '模拟发布失败' }), { status: 500 })) : window.savedFetch(...args)`);
  await click('[data-course-id="5"] [data-publish]');
  await waitFor(`${feedback('#admin-feedback')}.includes("模拟发布失败")`);
  assert.equal(await evaluate(`document.querySelector('[data-course-id="5"]').dataset.published`), 'true');
  await evaluate('window.fetch = window.savedFetch');
  await click('[data-course-id="5"] [data-publish]');
  await waitFor(`${feedback('#admin-feedback')}.includes("无法申请新的播放地址")`);
  assert.equal((await fetch(address + '/courses/5')).status, 404);
  assert.equal(await evaluate(feedback('[data-count="published"]')), '3');
  assert.equal(await evaluate(feedback('[data-count="draft"]')), '2');
  assert.ok(await evaluate(`document.querySelector('[data-course-id="5"] [data-public]').hidden`));
  await click('a[href="/admin/courses/5/edit"]');
  await waitFor('!!document.querySelector("#course-form")');
  assert.equal(await evaluate('document.querySelector(".editor header a") === null'), true);

  db.exec('UPDATE courses SET published = 0');
  await click('#logout');
  await waitFor('location.pathname === "/" && !!document.querySelector(".empty")');
  assert.match(await evaluate(feedback('.catalog-totals')), /0 门课程.*0 分 0 秒/);
  assert.match(await evaluate(feedback('.empty')), /暂无已发布课程/);
});
