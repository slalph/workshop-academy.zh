// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const lifetimeSeconds = 12 * 60 * 60;
const tokenFormat = /^[a-f0-9]{64}$/;
const dummySalt = Buffer.alloc(16);
const dummyHash = Buffer.alloc(64);

export function passwordRecord(password) {
  const salt = randomBytes(16);
  return [salt.toString('hex'), scryptSync(password, salt, 64).toString('hex')];
}

export function identifyToken(cookie) {
  const value = cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith('academy_session='))?.slice('academy_session='.length);
  if (value && tokenFormat.test(value)) {
    return createHash('sha256').update(value).digest('hex');
  }
  return null;
}

export function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

export function currentUser(db, tokenHash) {
  if (!tokenHash) return null;
  const row = db.prepare(`
    SELECT users.id, username, display_name, role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, Date.now());
  return row ? publicUser(row) : null;
}

export function checkCredentials(db, { username, password }) {
  const fields = {};
  if (typeof username !== 'string' || !username.trim()) fields.username = '请输入用户名。';
  if (typeof password !== 'string' || !password) fields.password = '请输入密码。';
  if (Object.keys(fields).length) return { fields };

  if (username.length > 64 || password.length > 200) return {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  const salt = row ? Buffer.from(row.password_salt, 'hex') : dummySalt;
  const expected = row ? Buffer.from(row.password_hash, 'hex') : dummyHash;
  const matches = timingSafeEqual(scryptSync(password, salt, 64), expected);
  return matches && row ? { user: publicUser(row) } : {};
}

export function revokeSession(db, tokenHash) {
  if (tokenHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function issueSession(db, userId, previousTokenHash) {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const now = Date.now();

  db.exec('BEGIN IMMEDIATE');
  try {
    revokeSession(db, previousTokenHash);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash, userId, now + lifetimeSeconds * 1000);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return sessionCookie(token);
}

export function sessionCookie(token = '') {
  return `academy_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? lifetimeSeconds : 0}`;
}

export function safeNext(value) {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\x00-\x1f\x7f-\x9f]/.test(value) ||
      value === '/login' || value.startsWith('/login?') || value.startsWith('/api/')) {
    return '/';
  }
  const target = new URL(value, 'http://localhost');
  if (target.pathname.startsWith('//')) return '/';
  return value;
}

export function loginLocation(next, switching = false) {
  const query = new URLSearchParams({ next: safeNext(next) });
  if (switching) query.set('switch', '1');
  return `/login?${query}`;
}
