// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHmac, timingSafeEqual } from 'node:crypto';

export function playbackEligibility(user, id, course) {
  if (id === null) return 404;
  if (!user) return 401;
  return course?.published ? 200 : 404;
}

function signature(db, id, expiresAt) {
  const { value } = db.prepare("SELECT value FROM settings WHERE key = 'playback_key'").get();
  return createHmac('sha256', Buffer.from(value, 'hex'))
    .update(`${id}:${expiresAt}`).digest('hex');
}

export function issuePlayback(db, id) {
  const expiresAt = Date.now() + 60_000;
  return { url: `/media/${id}?expires=${expiresAt}&signature=${signature(db, id, expiresAt)}`, expiresAt };
}

export function playbackStatus(db, id, query) {
  const expires = query.get('expires');
  const supplied = query.get('signature');
  if (query.getAll('expires').length !== 1 || query.getAll('signature').length !== 1 ||
      !/^\d{1,15}$/.test(expires) || !/^[a-f0-9]{64}$/.test(supplied)) return 403;
  const expected = signature(db, id, expires);
  if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) return 403;
  return Number(expires) <= Date.now() ? 410 : 200;
}
