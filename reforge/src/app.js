// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { findCourse, listCourses, numericId, serializeCourse, validateCourse, writeCourse } from './courses.js';
import { canPlay, issuePlayback, listVideos, openLocalFile, openVideo, playbackStatus, serveVideo } from './media.js';
import { coverSvg, render } from './pages.js';
import { checkCredentials, currentUser, identifyToken, issueSession, loginLocation, revokeSession, safeNext, sessionCookie } from './session.js';

export { seed } from './courses.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const maxBody = 65_536;
const staticTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const messages = {
  400: '请求格式不正确。',
  401: '请先登录。',
  403: '没有权限执行此操作。',
  404: '找不到请求的内容。',
  405: '此地址不支持该请求方法。',
  410: '播放地址已过期。',
  413: '请求内容过大。',
  415: '请求必须使用 application/json。',
  416: '请求的视频字节范围无法满足。',
  500: '服务暂时无法处理请求。',
};

class RequestError extends Error {
  constructor(status) {
    super(messages[status]);
    this.status = status;
  }
}

function send(req, res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function json(req, res, status, body) {
  send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function redirect(res, status, location) {
  const target = new URL(location, 'http://localhost');
  res.writeHead(status, { Location: target.pathname + target.search + target.hash });
  res.end();
}

async function readJson(req) {
  if (Number(req.headers['content-length']) > maxBody) {
    req.resume();
    throw new RequestError(413);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    req.on('error', reject);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBody) {
        chunks = [];
        reject(new RequestError(413));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (size > maxBody) return;
      try {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const value = raw.trim() ? JSON.parse(raw) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400);
        resolve(value);
      } catch {
        reject(new RequestError(400));
      }
    });
  });
}

function setDefaults(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

const routes = [
  [/^\/$/, 'home', 'GET'],
  [/^\/login$/, 'loginPage', 'GET'],
  [/^\/courses\/([^/]+)$/, 'coursePage', 'GET'],
  [/^\/admin$/, 'adminPage', 'GET'],
  [/^\/admin\/courses\/new$/, 'courseForm', 'GET'],
  [/^\/admin\/courses\/([^/]+)\/edit$/, 'courseEdit', 'GET'],
  [/^\/api\/session$/, 'session', 'GET'],
  [/^\/api\/login$/, 'login', 'POST'],
  [/^\/api\/logout$/, 'logout', 'POST'],
  [/^\/api\/health$/, 'health', 'GET'],
  [/^\/api\/courses$/, 'catalog', 'GET'],
  [/^\/api\/courses\/([^/]+)$/, 'course', 'GET'],
  [/^\/api\/courses\/([^/]+)\/play$/, 'play', 'POST'],
  [/^\/api\/admin\/courses$/, 'adminCatalog', 'GET', 'POST'],
  [/^\/api\/admin\/courses\/([^/]+)$/, 'adminCourse', 'GET', 'PATCH'],
  [/^\/api\/admin\/videos$/, 'adminVideos', 'GET'],
  [/^\/media\/([^/]+)$/, 'media', 'GET'],
  [/^\/covers\/([^/]+)\.svg$/, 'cover', 'GET'],
  [/^\/assets\/(.*)$/, 'assets', 'GET'],
  [/^\/favicon\.ico$/, 'favicon', 'GET'],
  [/^\/internal\/stop$/, 'stop', 'POST'],
];

function routeFor(path) {
  for (const [pattern, name, ...methods] of routes) {
    const match = pattern.exec(path);
    if (match) return { name, methods, parameter: match[1] };
  }
  return null;
}

async function serveAsset(req, res, path, fail) {
  let parts;
  try {
    parts = decodeURIComponent(path).split('/');
  } catch {
    return fail(404);
  }
  if (parts.some(part => !part || part.startsWith('.') || /[\\\0]/.test(part))) return fail(404);
  const type = staticTypes.get(extname(parts.at(-1)).toLowerCase());
  if (!type) return fail(404);

  const opened = await openLocalFile(publicRoot, parts);
  if (!opened) return fail(404);
  const { file, info } = opened;
  try {
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    res.setHeader('Cache-Control', 'public, no-cache');
    res.setHeader('Last-Modified', info.mtime.toUTCString());
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream(), res);
  } finally {
    await file.close();
  }
}

function validMaintenanceToken(supplied, configured) {
  if (typeof supplied !== 'string' || !configured) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function makeHandler({ db, mediaRoot, migrations, stopToken, stop }) {
  return async (req, res) => {
    setDefaults(res);
    const target = req.url || '/';
    const path = target.split('?')[0];
    const machine = ['/api/', '/internal/', '/media/'].some(prefix => path.startsWith(prefix));
    let url = new URL('http://localhost/');
    let user = null;

    function page({ courses = [], videos = [], eligibility = false, error } = {}) {
      const result = render({ url, user, courses, videos, eligibility, error });
      for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
      send(req, res, error?.status ?? result.status, 'text/html; charset=utf-8', result.html);
    }

    function fail(status, message = messages[status], fields) {
      if (machine) json(req, res, status, { error: message, ...(fields && { fields }) });
      else page({ error: { status, message } });
    }

    try {
      const host = req.headers.host;
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host ?? '')) return fail(400);
      if (!target.startsWith('/') || target.startsWith('//')) return fail(404);
      url = new URL(`http://localhost${target}`);
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const mutate = method !== 'GET';
      const origin = req.headers.origin;
      if (mutate && origin !== undefined && origin !== `http://${host}`) return fail(403);
      if (mutate && path.startsWith('/api/') &&
          req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415);

      const route = routeFor(path);
      const tokenHash = identifyToken(req.headers.cookie);
      user = currentUser(db, tokenHash);
      if (!route) return fail(404);
      if (!route.methods.includes(method)) {
        const allow = route.methods.flatMap(item => item === 'GET' ? ['GET', 'HEAD'] : [item]);
        res.setHeader('Allow', allow.join(', '));
        return fail(405);
      }

      if (path.startsWith('/admin') || path.startsWith('/api/admin/')) {
        if (!user) return machine ? fail(401) : redirect(res, 302, loginLocation(target));
        if (user.role !== 'admin') return fail(403);
      }

      const body = mutate && path.startsWith('/api/') ? await readJson(req) : {};
      const id = numericId(route.parameter);
      switch (route.name) {
        case 'home':
          return page({ courses: listCourses(db, true) });
        case 'loginPage':
          if (user && url.searchParams.get('switch') !== '1') {
            return redirect(res, 302, safeNext(url.searchParams.get('next')));
          }
          return page();
        case 'session':
          return json(req, res, 200, { user });
        case 'login': {
          const checked = checkCredentials(db, body);
          if (checked.fields) return fail(400, '请检查登录字段。', checked.fields);
          if (!checked.user) return fail(401, '用户名或密码错误。');
          res.setHeader('Set-Cookie', issueSession(db, checked.user.id, tokenHash));
          return json(req, res, 200, { user: checked.user });
        }
        case 'logout':
          revokeSession(db, tokenHash);
          res.setHeader('Set-Cookie', sessionCookie());
          return json(req, res, 200, { ok: true });
        case 'health':
          return json(req, res, 200, { ok: true, migrations: migrations() });
        case 'catalog':
          return json(req, res, 200, { courses: listCourses(db) });
        case 'coursePage':
        case 'course': {
          const course = findCourse(db, id);
          if (!course?.published) return fail(404);
          if (route.name === 'course') return json(req, res, 200, { course: serializeCourse(course) });
          return page({ courses: listCourses(db, true), eligibility: canPlay(user, course) });
        }
        case 'play': {
          if (id === null) return fail(404);
          if (!user) return fail(401);
          if (!canPlay(user, findCourse(db, id))) return fail(404);
          return json(req, res, 200, issuePlayback(db, id));
        }
        case 'media': {
          if (id === null) return fail(404);
          const status = playbackStatus(db, id, url.searchParams);
          if (status !== 200) return fail(status);
          const course = findCourse(db, id);
          const opened = course && await openVideo(mediaRoot, course.video_file);
          if (!opened) return fail(404);
          return await serveVideo(req, res, opened, fail);
        }
        case 'cover':
          if (id === null) return fail(404);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return send(req, res, 200, 'image/svg+xml', coverSvg(id));
        case 'assets':
          return await serveAsset(req, res, route.parameter, fail);
        case 'favicon':
          return redirect(res, 301, '/assets/favicon.svg');
        case 'adminPage':
        case 'courseForm':
        case 'courseEdit':
          if (route.name === 'courseEdit' && !findCourse(db, id)) return fail(404);
          return page({ courses: listCourses(db, true) });
        case 'adminVideos':
          return json(req, res, 200, { videos: await listVideos(mediaRoot) });
        case 'adminCatalog':
        case 'adminCourse': {
          const creating = route.name === 'adminCatalog';
          const course = creating ? null : findCourse(db, id);
          if (!creating && !course) return fail(404);
          if (method === 'GET') {
            return creating ? json(req, res, 200, { courses: listCourses(db, true) }) :
              json(req, res, 200, { course: serializeCourse(course, true) });
          }
          const videos = Object.hasOwn(body, 'videoFile') ? await listVideos(mediaRoot) : [];
          const result = validateCourse(body, creating, videos);
          if (result.error) return fail(400, result.error, result.fields);
          const saved = writeCourse(db, result.values, creating ? null : id);
          return json(req, res, creating ? 201 : 200, { course: serializeCourse(saved, true) });
        }
        case 'stop':
          if (!validMaintenanceToken(req.headers['x-maintenance-token'], stopToken)) return fail(403);
          res.once('finish', stop);
          return json(req, res, 202, { ok: true, message: '学堂正在停止。' });
      }
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy(error);
      } else if (error instanceof RequestError) {
        fail(error.status);
      } else {
        console.error(error);
        fail(500);
      }
    }
  };
}
