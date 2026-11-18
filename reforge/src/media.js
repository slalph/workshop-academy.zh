// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const videoName = /^[a-z0-9][a-z0-9-]{0,80}\.mp4$/;

function isWithin(root, path) {
  const local = relative(root, path);
  return local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

export async function openLocalFile(directory, parts) {
  try {
    const root = await realpath(directory);
    const candidate = resolve(root, ...parts);
    if (!isWithin(root, candidate)) return null;
    const actual = await realpath(candidate);
    if (!isWithin(root, actual) || !(await stat(actual)).isFile()) return null;
    const file = await open(actual, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (info.isFile()) return { file, info };
    } catch (error) {
      await file.close();
      throw error;
    }
    await file.close();
    return null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

export function openVideo(root, name) {
  return videoName.test(name) ? openLocalFile(root, [name]) : null;
}

async function read(file, size, offset) {
  const data = Buffer.alloc(size);
  return (await file.read(data, 0, size, offset)).bytesRead === size ? data : null;
}

async function movieDuration(file, limit, offset = 0, inMovie = false) {
  while (offset + 8 <= limit) {
    const header = await read(file, 8, offset);
    if (!header) break;
    let size = header.readUInt32BE();
    let headerSize = 8;
    const type = header.toString('ascii', 4, 8);
    if (size === 1) {
      if (offset + 16 > limit) break;
      const extended = await read(file, 8, offset + 8);
      if (!extended) break;
      size = Number(extended.readBigUInt64BE());
      headerSize = 16;
    } else if (size === 0) {
      size = limit - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || size > limit - offset) break;

    const body = offset + headerSize;
    if (!inMovie && type === 'moov') {
      const duration = await movieDuration(file, offset + size, body, true);
      if (duration !== null) return duration;
    }
    if (inMovie && type === 'mvhd') {
      const version = await read(file, 1, body);
      if (!version || (version[0] !== 0 && version[0] !== 1)) return null;
      const requiredSize = version[0] === 1 ? 32 : 20;
      if (size - headerSize < requiredSize) return null;
      const data = await read(file, requiredSize, body);
      if (!data) return null;
      const scale = data.readUInt32BE(version[0] === 1 ? 20 : 12);
      const duration = version[0] === 1 ? data.readBigUInt64BE(24) : BigInt(data.readUInt32BE(16));
      const unknown = version[0] === 1 ? 0xffffffffffffffffn : 0xffffffffn;
      if (!scale || duration === unknown) return null;
      const seconds = Math.round(Number(duration) / scale);
      return Number.isSafeInteger(seconds) ? seconds : null;
    }
    offset += size;
  }
  return null;
}

export async function listVideos(root) {
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const videos = [];
  for (const name of names.sort()) {
    const opened = await openVideo(root, name);
    if (!opened) continue;
    const { file, info } = opened;
    try {
      videos.push({ file: name, sizeBytes: info.size, durationSeconds: await movieDuration(file, info.size) });
    } finally {
      await file.close();
    }
  }
  return videos;
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const total = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n || size === 0) return { unsatisfiable: true };
    return { start: Number(suffix >= total ? 0n : total - suffix), end: size - 1 };
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : total - 1n;
  if (match[2] && end < start) return null;
  if (start >= total) return { unsatisfiable: true };
  return { start: Number(start), end: Number(end >= total ? total - 1n : end) };
}

export async function serveVideo(req, res, opened, fail) {
  const { file, info } = opened;
  try {
    const range = byteRange(req.headers.range, info.size);
    if (range?.unsatisfiable) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      fail(416);
      return;
    }
    if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': range ? range.end - range.start + 1 : info.size,
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream(range ?? {}), res);
  } finally {
    await file.close();
  }
}
