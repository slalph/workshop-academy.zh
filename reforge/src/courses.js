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
  ['Python 入门：写出第一个程序', '从运行环境开始，写出并运行第一个 Python 程序。', '认识变量、输入与输出。\n\n动手完成一段能读取输入并返回结果的程序。', '周老师', 'beginner', 'python-basics.mp4', 18],
  ['用 Git 管好每一次修改', '用提交、分支和差异对比管理项目的修改。', '掌握工作区、暂存区和版本历史之间的关系。', '赵老师', 'beginner', 'git-essentials.mp4', 20],
  ['Web 接口设计与测试', '学习设计清晰的 HTTP 接口，并为它编写测试。', '从请求与响应入手，理解状态码及接口约定。', '林老师', 'intermediate', 'web-api-testing.mp4', 22],
  ['SQLite 数据建模实践', '用约束、关联和事务组织应用数据。', '围绕实际场景设计表结构，并用查询检验模型。', '许老师', 'advanced', 'sqlite-modeling.mp4', 16],
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
