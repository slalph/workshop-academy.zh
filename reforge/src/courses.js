// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { randomBytes } from 'node:crypto';
import { passwordRecord } from './session.js';

const levels = { beginner: '入门', intermediate: '进阶', advanced: '高级' };

export function numericId(value) {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function serializeCourse(row, management = false) {
  const course = {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    instructor: row.instructor,
    durationSeconds: row.duration_seconds,
    published: Boolean(row.published),
    updatedAt: row.updated_at,
    level: row.level,
    levelLabel: levels[row.level],
    url: `/courses/${row.id}`,
    coverUrl: `/covers/${row.id}.svg`,
  };
  if (management) {
    course.videoFile = row.video_file;
    course.createdAt = row.created_at;
  }
  return course;
}

export function listCourses(db, management = false) {
  const query = management ? 'SELECT * FROM courses ORDER BY id' :
    'SELECT * FROM courses WHERE published = 1 ORDER BY id';
  return db.prepare(query).all().map(row => serializeCourse(row, management));
}

export function findCourse(db, id) {
  return id === null ? undefined : db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
}

const textFields = {
  title: ['标题', 80],
  summary: ['简介', 200],
  description: ['介绍', 5000],
  instructor: ['讲师', 40],
};

export function validateCourse(input, creating, videos) {
  const keys = Object.keys(input);
  const writable = [...Object.keys(textFields), 'level', 'videoFile', 'published'];
  if (keys.some(key => !writable.includes(key))) return { error: '请求包含未知课程字段。' };
  if (!creating && !keys.length) return { error: '请提交至少一个要修改的字段。' };

  const fields = {};
  const values = creating ? { description: '', published: 0 } : {};
  for (const [key, [label, limit]] of Object.entries(textFields)) {
    if (!Object.hasOwn(input, key) && (!creating || key === 'description')) continue;
    const original = input[key];
    const value = typeof original === 'string' ? original.replace(/\r\n?/g, '\n').trim() : null;
    if (value === null || (key !== 'description' && !value)) {
      fields[key] = `请输入${label}。`;
    } else if ([...value].length > limit) {
      fields[key] = `${label}最多可输入 ${limit} 个字符。`;
    } else {
      values[key] = value;
    }
  }

  if (creating || Object.hasOwn(input, 'level')) {
    if (typeof input.level === 'string' && Object.hasOwn(levels, input.level)) values.level = input.level;
    else fields.level = '请选择有效的课程难度。';
  }
  if (creating || Object.hasOwn(input, 'videoFile')) {
    const video = videos.find(item => item.file === input.videoFile);
    if (video) {
      values.video_file = video.file;
      values.duration_seconds = video.durationSeconds ?? 0;
    } else {
      fields.videoFile = '请选择素材清单中的视频。';
    }
  }
  if (Object.hasOwn(input, 'published')) {
    if (typeof input.published === 'boolean') values.published = Number(input.published);
    else fields.published = '发布状态必须为布尔值。';
  }
  return Object.keys(fields).length ? { error: '请检查课程字段。', fields } : { values };
}

export function writeCourse(db, values, id = null) {
  const now = Date.now();
  const changes = { ...values, updated_at: now };
  if (id === null) {
    changes.created_at = now;
    const columns = Object.keys(changes);
    const placeholders = columns.map(() => '?').join(', ');
    const result = db.prepare(`INSERT INTO courses (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...Object.values(changes));
    return findCourse(db, Number(result.lastInsertRowid));
  }
  const assignments = Object.keys(changes).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE courses SET ${assignments} WHERE id = ?`).run(...Object.values(changes), id);
  return findCourse(db, id);
}

const examples = [
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

export function seed(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get()) {
      const account = db.prepare('INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)');
      account.run('admin', '王教务', 'admin', ...passwordRecord('123456'));
      account.run('student', '李小明', 'student', ...passwordRecord('123456'));
      account.run('student2', '陈小红', 'student', ...passwordRecord('123456'));

      const now = Date.now();
      const course = db.prepare(`
        INSERT INTO courses (title, summary, description, instructor, level, video_file,
          duration_seconds, published, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      examples.forEach((example, index) => course.run(...example, Number(index < 3), now, now));

      const setting = db.prepare('INSERT INTO settings VALUES (?, ?)');
      setting.run('playback_key', randomBytes(32).toString('hex'));
      setting.run('seeded', '1');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
