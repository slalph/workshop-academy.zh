// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { safeNext, loginLocation } from './session.js';

const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
const localDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
const localTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const levels = { beginner: '入门', intermediate: '进阶', advanced: '高级' };

const duration = seconds => {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  return `${hours ? `${hours} 小时 ` : ''}${minutes ? `${minutes} 分 ` : ''}${whole % 60} 秒`;
};


function shell({ title, user, pathname, content }) {
  const login = loginLocation(pathname);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · 学堂</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/academy.css">
<script src="/assets/academy.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main-content">跳到主要内容</a>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="学堂首页"><img src="/assets/favicon.svg" alt="" width="32" height="32">学堂</a>
    <nav aria-label="主导航">
      <a href="/" ${pathname === '/' ? 'aria-current="page"' : ''}>首页</a>
      <a href="/#courses">课程目录</a>
      ${user?.role === 'admin' ? `<a href="/admin" ${pathname.startsWith('/admin') ? 'aria-current="page"' : ''}>课程管理</a>` : ''}
    </nav>
    <div class="account">
      ${user ? `<span class="account-name">${escape(user.displayName)} <small>${user.role === 'admin' ? '管理员' : '学员'}</small></span>
        <button class="quiet" id="logout" type="button">退出登录</button>` : pathname !== '/login' ? `<a class="button compact" href="${escape(login)}">登录</a>` : ''}
    </div>
  </div>
  <div class="container feedback" id="site-feedback" role="alert"></div>
</header>
<main id="main-content" class="container main" tabindex="-1">${content}</main>
<footer class="site-footer"><div class="container"><span>学堂</span><a href="/#courses">课程目录</a></div></footer>
</body>
</html>`;
}

function catalog(courses, user) {
  const published = courses.filter(course => course.published);
  const seconds = published.reduce((total, course) => total + course.durationSeconds, 0);
  return `<section class="hero">
    <div class="hero-copy">
      <h1>学堂</h1>
      <p>浏览课程目录，按自己的节奏学习。</p>
      <div class="actions"><a class="button" href="#courses">浏览课程</a>
        ${user ? '' : '<a class="button secondary" href="/login">登录学堂</a>'}</div>
    </div>
    <img class="hero-art" src="/assets/library.svg" alt="" width="420" height="208">
  </section>
  <section id="courses" class="board" aria-labelledby="courses-title">
    <div class="section-heading">
      <h2 id="courses-title">课程目录</h2>
      <p class="muted">${published.length} 门课程 <span aria-hidden="true">·</span> 总时长 ${duration(seconds)}</p>
    </div>
    ${published.length ? `<ul class="course-grid">${published.map(course => `
      <li><a class="course-card" href="/courses/${course.id}">
        <img src="/covers/${course.id}.svg" alt="" width="480" height="270">
        <div class="card-content">
          <div class="card-meta"><span>课程 #${course.id}</span><span>${duration(course.durationSeconds)}</span></div>
          <h3>${escape(course.title)}</h3>
          <p>${escape(course.summary)}</p>
          <div class="card-footer"><span class="pill">${escape(course.levelLabel)}</span><span>讲师 ${escape(course.instructor)}</span></div>
        </div>
      </a></li>`).join('')}</ul>` : '<p class="empty">暂无已发布课程。</p>'}
  </section>`;
}

const crumb = (href, label) => `<nav class="breadcrumb" aria-label="面包屑"><a href="${href}">← ${label}</a></nav>`;

function detail(course, eligibility, user) {
  const description = String(course.description).split(/\n\s*\n/).filter(paragraph => paragraph.trim());
  return `${crumb('/#courses', '返回课程目录')}
  <article>
    <header class="page-heading"><p class="muted">课程 #${course.id} <span class="pill">${escape(course.levelLabel)}</span></p>
      <h1>${escape(course.title)}</h1><p class="lead">${escape(course.summary)}</p>
      <dl class="course-facts">
        <div><dt>讲师</dt><dd>${escape(course.instructor)}</dd></div>
        <div><dt>时长</dt><dd>${duration(course.durationSeconds)}</dd></div>
        <div><dt>更新日期</dt><dd>${localDate.format(course.updatedAt)}</dd></div>
      </dl>
    </header>
    <section class="watch" aria-label="课程视频" data-player data-course-id="${course.id}" data-login="${escape(loginLocation('/courses/' + course.id))}">
      <div class="stage">
        <img data-poster src="/covers/${course.id}.svg" alt="" width="480" height="270">
        ${eligibility ? '<video hidden controls playsinline preload="none" aria-label="课程视频"></video>' : ''}
      </div>
      <div class="watch-actions">
        ${eligibility ? '<button type="button" class="button" data-start>开始观看</button>' : `<a class="button" href="${escape(loginLocation('/courses/' + course.id, Boolean(user)))}">登录后观看</a>`}
        <p class="feedback" role="status" data-player-feedback></p>
      </div>
    </section>
    ${description.length ? `<section class="description"><h2>课程介绍</h2>${description.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}</section>` : ''}
  </article>`;
}

function login(user, next) {
  return `${crumb('/#courses', '返回课程目录')}
  <section class="auth-layout">
    <div class="panel">
      <h1>${user ? '切换账号' : '登录学堂'}</h1>
      ${user ? `<p class="lead">当前以 ${escape(user.displayName)}（${escape(user.username)}）登录。登录另一个账号后将替换当前会话。</p>` : ''}
      <form id="login-form" method="post" data-next="${escape(next)}" novalidate>
        ${field('用户名', 'username', '<input id="username" name="username" autocomplete="username" required aria-describedby="username-error">')}
        ${field('密码', 'password', '<input id="password" name="password" type="password" autocomplete="current-password" required aria-describedby="password-error">')}
        <p class="feedback" role="alert" data-form-feedback></p>
        <button class="button" type="submit">登录</button>
      </form>
    </div>
    <aside class="panel demo" aria-labelledby="demo-title">
      <h2 id="demo-title">示例账号</h2>
      <p class="muted">选择账号即可登录，示例密码为 <code>123456</code>。</p>
      <div class="demo-list">
        <button class="button secondary" type="button" data-demo="admin"><strong>王教务</strong><span>管理员 · admin</span></button>
        <button class="button secondary" type="button" data-demo="student"><strong>李小明</strong><span>学员 · student</span></button>
        <button class="button secondary" type="button" data-demo="student2"><strong>陈小红</strong><span>学员 · student2</span></button>
      </div>
    </aside>
  </section>`;
}

function field(label, key, input) {
  return `<div class="field"><label for="${key}">${label}</label>${input}<p class="field-error" id="${key}-error"></p></div>`;
}

function adminList(courses, url) {
  const published = courses.filter(course => course.published).length;
  const change = url.searchParams.get('change');
  const updated = courses.find(course => String(course.id) === url.searchParams.get('course'));
  const confirmation = (change === 'created' || change === 'updated') && updated ?
    `已${change === 'created' ? '创建' : '更新'}课程「${escape(updated.title)}」。` : '';
  return `<header class="page-heading split"><div><h1>课程管理</h1></div>
    <a class="button" href="/admin/courses/new">新建课程</a></header>
  <dl class="stats"><div><dt>全部课程</dt><dd data-count="all">${courses.length}</dd></div>
    <div><dt>已发布</dt><dd data-count="published">${published}</dd></div>
    <div><dt>草稿</dt><dd data-count="draft">${courses.length - published}</dd></div></dl>
  <p id="admin-feedback" class="feedback" role="status">${confirmation}</p>
  ${courses.length ? `<ul class="management-list">${courses.map(course => `
    <li class="management-row" data-course-id="${course.id}" data-published="${course.published}">
      <div><p class="muted">课程 #${course.id}</p><h2>${escape(course.title)}</h2>
        <p class="muted">${escape(course.instructor)} · ${escape(course.levelLabel)} · ${duration(course.durationSeconds)}</p></div>
      <div><span class="pill" data-state>${course.published ? '已发布' : '草稿'}</span>
        <p class="muted">更新于 <time data-updated datetime="${new Date(course.updatedAt).toISOString()}">${localTime.format(course.updatedAt)}</time></p></div>
      <div class="actions row-actions"><a href="/admin/courses/${course.id}/edit">编辑</a>
        <a data-public href="/courses/${course.id}" ${course.published ? '' : 'hidden'}>公开详情</a>
        <button class="button secondary compact" type="button" data-publish>${course.published ? '取消发布' : '发布'}</button></div>
    </li>`).join('')}</ul>` : '<p class="empty">暂无课程。</p>'}`;
}

function adminForm(course) {
  const textField = (key, label) => field(label, key, `<input id="${key}" name="${key}" value="${escape(course?.[key])}" required aria-describedby="${key}-error">`);
  const textarea = (key, label, rows, required) => field(label, key,
    `<textarea id="${key}" name="${key}" rows="${rows}" ${required ? 'required' : ''} aria-describedby="${key}-error">\n${escape(course?.[key])}</textarea>`);
  return `${crumb('/admin', '返回课程管理')}
  <section class="editor panel">
    <h1>${course ? '编辑课程' : '新建课程'}</h1>
    <form id="course-form" method="post" data-id="${course?.id ?? ''}" data-video="${escape(course?.videoFile)}" novalidate>
      ${textField('title', '标题')}
      ${textarea('summary', '简介', 3, true)}
      ${textarea('description', '课程介绍', 7, false)}
      <div class="form-columns">${textField('instructor', '讲师')}
      ${field('难度', 'level', `<select id="level" name="level" required aria-describedby="level-error">
        <option value="">请选择难度</option>
        ${Object.entries(levels).map(([value, label]) => `<option value="${value}" ${course?.level === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`)}</div>
      ${field('本地视频', 'videoFile', `<select id="videoFile" name="videoFile" required aria-describedby="video-feedback videoFile-error">
        ${course ? `<option value="${escape(course.videoFile)}">${escape(course.videoFile)}</option>` : '<option value="">请选择视频</option>'}
      </select><p class="muted" role="status" id="video-feedback">正在加载视频清单…</p>`)}
      <div class="field check-field"><label for="published"><input type="checkbox" name="published" id="published" ${course?.published ? 'checked' : ''} aria-describedby="published-error">发布课程</label>
        <p class="field-error" id="published-error"></p></div>
      <p class="feedback" role="alert" data-form-feedback></p>
      <div class="actions"><button class="button" type="submit">${course ? '保存修改' : '创建课程'}</button><a href="/admin">取消</a></div>
    </form>
  </section>`;
}

function errorPage(error, url, user) {
  const switchAccount = Boolean(user);
  return `<section class="panel error-page">
    <p class="muted">HTTP ${error.status}</p>
    <h1>${error.status === 404 ? '页面未找到' : error.status === 403 ? '访问受限' : '请求未完成'}</h1>
    <p>${escape(error.message)}</p>
    <div class="actions"><a class="button" href="/#courses">返回课程目录</a>
      ${[401, 403].includes(error.status) ? `<a class="button secondary" href="${escape(loginLocation(url.pathname + url.search, switchAccount))}">${switchAccount ? '切换账号登录' : '登录'}</a>` : ''}</div>
  </section>`;
}

const redirect = location => ({ status: 302, headers: { Location: location }, html: '' });
const notFound = { status: 404, message: '请求的页面或课程不存在。' };
const courseMatch = (courses, match) => {
  const id = match?.[1];
  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return undefined;
  return courses.find(course => course.id === Number(id));
};

export function render({ url, user = null, courses = [], eligibility = Boolean(user), error }) {
  const pathname = url.pathname;
  const respond = (title, content, status = 200) => ({ status, html: shell({ title, content, user, pathname }) });
  const showError = problem => respond('请求未完成', errorPage(problem, url, user), problem.status);
  if (error) return showError(error);
  if (pathname === '/') return respond('课程目录', catalog(courses, user));
  if (pathname === '/login') {
    const next = safeNext(url.searchParams.get('next'));
    if (user && url.searchParams.get('switch') !== '1') return redirect(next);
    return respond(user ? '切换账号' : '登录', login(user, next));
  }
  const publicMatch = /^\/courses\/([^/]+)$/.exec(pathname);
  if (publicMatch) {
    const course = courseMatch(courses, publicMatch);
    return course?.published ? respond(course.title, detail(course, eligibility, user)) : showError(notFound);
  }
  const editMatch = /^\/admin\/courses\/([^/]+)\/edit$/.exec(pathname);
  if (pathname === '/admin' || pathname === '/admin/courses/new' || editMatch) {
    if (!user) return redirect(loginLocation(pathname + url.search));
    if (user.role !== 'admin') return showError({ status: 403, message: '请使用管理员账号访问课程管理。' });
    if (pathname === '/admin') return respond('课程管理', adminList(courses, url));
    if (!editMatch) return respond('新建课程', adminForm(null));
    const course = courseMatch(courses, editMatch);
    return course ? respond('编辑课程', adminForm(course)) : showError(notFound);
  }
  return showError(notFound);
}

export function coverSvg(id) {
  const palettes = [
    ['#1f3548', '#375871', '#82c7c5', '#f6d294', '#fbf6e8'],
    ['#343858', '#505880', '#d6a1ab', '#f2d790', '#f7e5ce'],
    ['#244c47', '#3a6761', '#92bd9b', '#f1c986', '#fff1d1'],
    ['#50364b', '#79546e', '#e1a5bb', '#f4c89a', '#fff2df']
  ];
  const [background, tile, accent, gold, paper] = palettes[(id - 1) % palettes.length];
  const seed = BigInt(id);
  const pixels = Array.from({ length: 20 }, (_, index) => {
    const position = (seed * 67n + BigInt(index * index * 29 + index * 13)) % 997n;
    const x = 6 + Number(position % 67n);
    const y = 5 + Number(position / 67n) * 2;
    return `<rect x="${x}" y="${y}" width="2" height="2" fill="${index % 3 ? tile : accent}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 80 45" shape-rendering="crispEdges">
    <rect width="80" height="45" fill="${background}"/>
    <path d="M0 41h80v4H0zM0 0h80v1H0z" fill="${tile}"/>
    ${pixels}
    <path d="M20 32h40v3h-4v2H24v-2h-4z" fill="${tile}"/>
    <path d="M23 13h11v2h5v3h2v-3h5v-2h11v17H46v2h-5v2h-2v-2h-5v-2H23z" fill="${accent}"/>
    <path d="M25 15h9v2h5v13h-5v-2h-9zm30 0h-9v2h-5v13h5v-2h9z" fill="${paper}"/>
    <path d="M28 19h7v2h-7zm0 4h7v2h-7zm17-4h7v2h-7zm0 4h7v2h-7z" fill="${tile}"/>
    <path d="M60 9h2v3h3v2h-3v3h-2v-3h-3v-2h3zM17 24h2v2h2v2h-2v2h-2v-2h-2v-2h2z" fill="${gold}"/>
    <desc>课程 ${id} 的像素插图</desc>
  </svg>`;
}
