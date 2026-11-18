// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

async function request(path, method = 'GET', body = {}) {
  const options = method === 'GET' ? {} : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  let response;
  let data;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('无法连接学堂。请检查连接后重试。');
  }
  try {
    data = await response.json();
  } catch {
    throw new Error('学堂返回了无法读取的响应，请重试。');
  }
  if (!response.ok) {
    const problem = new Error(data.error || '请求失败，请重试。');
    problem.status = response.status;
    problem.fields = data.fields;
    throw problem;
  }
  return data;
}

function setFieldErrors(form, errors = {}) {
  let first;
  for (const control of form.querySelectorAll('[name]')) {
    const output = document.getElementById(control.name + '-error');
    const message = Object.hasOwn(errors, control.name) ? errors[control.name] : '';
    if (output) output.textContent = message;
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      first ??= control;
    } else {
      control.removeAttribute('aria-invalid');
    }
  }
  first?.focus();
  return Boolean(first);
}

const logout = document.getElementById('logout');
logout?.addEventListener('click', async () => {
  const feedback = document.getElementById('site-feedback');
  feedback.textContent = '';
  logout.disabled = true;
  try {
    await request('/api/logout', 'POST');
    location.assign('/');
  } catch (problem) {
    feedback.textContent = problem.message;
    logout.disabled = false;
  }
});

const loginForm = document.getElementById('login-form');
if (loginForm) {
  const username = loginForm.elements.namedItem('username');
  const password = loginForm.elements.namedItem('password');
  const feedback = loginForm.querySelector('[data-form-feedback]');
  const examples = document.querySelectorAll('[data-demo]');
  const buttons = [loginForm.querySelector('button'), ...examples];
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (buttons[0].disabled) return;
    feedback.textContent = '';
    const errors = {};
    if (!username.value.trim()) errors.username = '请输入用户名。';
    if (!password.value) errors.password = '请输入密码。';
    if (setFieldErrors(loginForm, errors)) {
      feedback.textContent = '请填写登录信息。';
      return;
    }
    buttons.forEach(button => { button.disabled = true; });
    try {
      await request('/api/login', 'POST', { username: username.value, password: password.value });
      location.assign(loginForm.dataset.next);
    } catch (problem) {
      buttons.forEach(button => { button.disabled = false; });
      feedback.textContent = problem.message;
      if (!setFieldErrors(loginForm, problem.fields) && problem.status === 401) {
        password.setAttribute('aria-invalid', 'true');
        password.focus();
      }
    }
  });
  examples.forEach(button => button.addEventListener('click', () => {
    username.value = button.dataset.demo;
    password.value = '123456';
    loginForm.requestSubmit();
  }));
}

const adminFeedback = document.getElementById('admin-feedback');
if (adminFeedback) {
  const formatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = [...document.querySelectorAll('[data-course-id]')];
  rows.forEach(row => {
    const button = row.querySelector('[data-publish]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      adminFeedback.textContent = '';
      try {
        const { course } = await request('/api/admin/courses/' + row.dataset.courseId, 'PATCH', {
          published: row.dataset.published !== 'true'
        });
        row.dataset.published = String(course.published);
        row.querySelector('[data-state]').textContent = course.published ? '已发布' : '草稿';
        button.textContent = course.published ? '取消发布' : '发布';
        const updated = row.querySelector('[data-updated]');
        updated.dateTime = new Date(course.updatedAt).toISOString();
        updated.textContent = formatter.format(course.updatedAt);
        row.querySelector('[data-public]').hidden = !course.published;
        const count = rows.filter(item => item.dataset.published === 'true').length;
        document.querySelector('[data-count="all"]').textContent = rows.length;
        document.querySelector('[data-count="published"]').textContent = count;
        document.querySelector('[data-count="draft"]').textContent = rows.length - count;
        const effect = course.published ?
          '课程已进入公开目录，登录的用户可以申请新的播放地址。' :
          '课程已从公开目录移除，无法申请新的播放地址。';
        adminFeedback.textContent = '「' + course.title + '」' + (course.published ? '已发布。' : '已取消发布。') + effect;
      } catch (problem) {
        adminFeedback.textContent = problem.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}

const courseForm = document.getElementById('course-form');
if (courseForm) {
  const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const video = courseForm.elements.namedItem('videoFile');
  const videoFeedback = document.getElementById('video-feedback');
  const feedback = courseForm.querySelector('[data-form-feedback]');
  const button = courseForm.querySelector('[type="submit"]');
  const id = courseForm.dataset.id;
  const values = () => ({
    ...Object.fromEntries(new FormData(courseForm)),
    published: courseForm.elements.namedItem('published').checked
  });
  const original = values();
  const listVideoDescription = item => {
    const time = item.durationSeconds === null ? '时长未知' : item.durationSeconds + ' 秒';
    const size = item.sizeBytes >= 1048576 ? formatter.format(item.sizeBytes / 1048576) + ' MB' :
      item.sizeBytes >= 1024 ? formatter.format(item.sizeBytes / 1024) + ' KB' : item.sizeBytes + ' 字节';
    return item.file + ' · ' + time + ' · ' + size;
  };
  request('/api/admin/videos').then(({ videos }) => {
    const previous = video.value;
    const available = videos.some(item => item.file === previous);
    video.replaceChildren(new Option('请选择视频', ''));
    for (const item of videos) video.add(new Option(listVideoDescription(item), item.file));
    if (previous && !available) video.add(new Option(previous + '（原文件缺失）', previous));
    video.value = previous;
    const empty = videos.length ? '' : '暂无可用的本地视频。';
    const missing = previous && !available ? '原视频文件缺失，请选择可用的视频。' : '';
    videoFeedback.textContent = empty + missing;
  }).catch(problem => {
    videoFeedback.textContent = '加载视频清单失败。' + problem.message;
  });
  courseForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    feedback.textContent = '';
    const current = values();
    const data = id ? Object.fromEntries(Object.entries(current).filter(([key, value]) => original[key] !== value)) : current;
    const errors = {};
    for (const input of courseForm.querySelectorAll('[required]')) {
      if (!input.value.trim()) errors[input.name] = input.tagName === 'SELECT' ? '请选择此项。' : '请填写此项。';
    }
    if (setFieldErrors(courseForm, errors)) {
      feedback.textContent = '请填写必填项。';
      return;
    }
    if (id && !Object.keys(data).length) {
      feedback.textContent = '请修改至少一项课程资料后再保存。';
      return;
    }
    button.disabled = true;
    try {
      const { course } = await request(id ? '/api/admin/courses/' + id : '/api/admin/courses', id ? 'PATCH' : 'POST', data);
      location.assign('/admin?' + new URLSearchParams({ change: id ? 'updated' : 'created', course: course.id }));
    } catch (problem) {
      feedback.textContent = problem.message;
      button.disabled = false;
      setFieldErrors(courseForm, problem.fields);
    }
  });
}

const player = document.querySelector('[data-player]');
const start = player?.querySelector('[data-start]');
if (start) {
  const video = player.querySelector('video');
  const poster = player.querySelector('[data-poster]');
  const feedback = player.querySelector('[data-player-feedback]');
  const endpoint = '/api/courses/' + player.dataset.courseId + '/play';
  let requesting = false;
  let attempts = 0;
  let position = 0;
  let resume = false;
  let restoring = false;
  let address = '';
  let intendedPlaying = false;

  function play() {
    video.play().catch(problem => {
      if (problem.name === 'NotAllowedError') feedback.textContent = '请使用视频控件手动开始播放。';
    });
  }

  function showProblem(problem, initial) {
    if (problem.status === 401) {
      location.assign(player.dataset.login);
    } else {
      feedback.textContent = problem.message;
      if (initial) start.disabled = false;
    }
  }

  start.addEventListener('click', async () => {
    if (requesting) return;
    feedback.textContent = '正在获取播放地址…';
    requesting = true;
    start.disabled = true;
    try {
      const data = await request(endpoint, 'POST');
      address = data.url;
      video.src = address;
      video.hidden = false;
      poster.hidden = true;
      start.hidden = true;
      feedback.textContent = '';
      intendedPlaying = true;
      play();
    } catch (problem) {
      showProblem(problem, true);
    } finally {
      requesting = false;
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!restoring && Number.isFinite(video.currentTime)) position = video.currentTime;
  });
  video.addEventListener('seeking', () => {
    if (!restoring && Number.isFinite(video.currentTime)) position = video.currentTime;
  });
  video.addEventListener('play', () => { intendedPlaying = true; });
  video.addEventListener('pause', () => {
    if (!video.error && !restoring) intendedPlaying = false;
  });
  video.addEventListener('playing', () => {
    attempts = 0;
    feedback.textContent = '';
  });
  video.addEventListener('loadedmetadata', () => {
    if (!restoring) return;
    video.currentTime = Number.isFinite(video.duration) ? Math.min(position, video.duration) : position;
    restoring = false;
    if (resume) play();
  });
  video.addEventListener('error', async () => {
    if (!address || requesting) return;
    if (attempts >= 2) {
      feedback.textContent = '无法继续读取视频，请刷新页面后重试。';
      return;
    }
    if (!restoring) {
      position = video.currentTime || position;
      resume = intendedPlaying;
    }
    restoring = true;
    requesting = true;
    const renew = async () => {
      while (attempts < 2) {
        attempts += 1;
        try {
          return await request(endpoint, 'POST');
        } catch (problem) {
          showProblem(problem, false);
          if (problem.status === 401) return null;
          if (attempts >= 2) feedback.textContent += ' 请刷新页面后重试。';
        }
      }
      return null;
    };
    feedback.textContent = '正在重新获取播放地址…';
    const data = await renew();
    requesting = false;
    if (!data) {
      restoring = false;
      return;
    }
    address = data.url;
    video.src = address;
    feedback.textContent = '';
    video.load();
  });
}
