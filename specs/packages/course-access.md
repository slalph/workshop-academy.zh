<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# course-access: 课程观看资格

## 意图

规定现有学堂签发播放地址、展示观看入口和读取本地视频的行为。
本包描述报名功能加入前的观看规则。

## 外部行为

### course-access-1

当客户端以 `POST /api/courses/:id/play` 请求课程的新播放地址时，学堂应按有效会话 [[session-4](session.md#session-4)]、有效课程编号 [[web-5](web.md#web-5)] 和公开详情的发布状态 [[catalog-2](catalog.md#catalog-2)] 决定是否签发地址：

| 状态 | 结果 |
| --- | --- |
| 编号有效而未登录 | 返回 401，不返回播放地址 |
| 编号无效 | 返回 404，不返回播放地址 |
| 已登录，课程不存在或未发布 | 返回 404，不返回播放地址 |
| 已登录，课程已发布 | 返回 200 和 `{"url": "...", "expiresAt": 0}`，其中 `expiresAt` 为到期的毫秒时间戳，默认有效期 60 秒 |

- 课程取消发布后，不再为它签发新地址。

### course-access-2

当浏览器打开已发布课程的详情页 [[catalog-2](catalog.md#catalog-2)] 时，学堂应按签发播放地址的同一资格判定展示观看入口 [[course-access-1](#course-access-1)]：

| 状态 | 观看入口 |
| --- | --- |
| 未登录 | 登录入口，登录后回到本页 [[session-8](session.md#session-8)] [[session-10](session.md#session-10)] |
| 已登录 | “开始观看”按钮，点击后按播放启动流程操作 [[course-access-15](#course-access-15)] |

- 页面本身不包含播放地址。

### course-access-3

给定播放地址由学堂签发且尚未到期，当客户端以 `GET` 或 `HEAD` 读取该地址时，学堂应读取其课程当前关联的视频 [[course-admin-3](course-admin.md#course-admin-3)]，无需登录会话且课程取消发布不影响地址在有效期内的使用：

- 课程或视频文件缺失、文件名无效或路径未指向普通文件时返回 404。
- 视频存在时按字节服务规则响应 [[course-access-13](#course-access-13)]。

### course-access-4

当客户端读取签名无效或已到期的播放地址时，学堂应拒绝返回视频内容：

| 情形 | 结果 |
| --- | --- |
| 课程编号无效 [[web-5](web.md#web-5)] | 返回 404 |
| 课程编号有效，签名、到期时间或课程编号被改动，或缺少签名 | 返回 403 |
| 播放地址已到期 | 返回 410 |

### course-access-5

当客户端绕过播放地址，按文件名或其他路径直接请求视频文件时，学堂应拒绝返回视频内容。

### course-access-6

如果正在播放，当浏览器因播放地址到期而读取视频失败时，课程页应重新请求播放地址 [[course-access-1](#course-access-1)]，并从当前进度继续播放。

### course-access-13

当学堂响应授权视频读取 [[course-access-3](#course-access-3)] 时，学堂应按 `Range` 请求提供 MP4：

| 情形 | 结果 |
| --- | --- |
| 无范围，格式不识别、多段或起止颠倒 | 200，完整文件 |
| 单段闭区间、开放末尾或后缀范围可满足 | 206，截取到实际文件边界并返回 `Content-Range` |
| 起点超出文件或请求 0 字节后缀 | 416，返回 `Content-Range: bytes */<文件大小>` |

- 成功响应包含 `Content-Type: video/mp4`、`Accept-Ranges: bytes` 及相应的 `Content-Length`。
- `HEAD` 只返回与 `GET` 对应的状态和响应头 [[web-9](web.md#web-9)]。

### course-access-14

当浏览器在取得播放地址后遇到视频读取错误时，课程页应避免并发续签，并在下一次成功播放前最多尝试两次续签 [[course-access-6](#course-access-6)]：

- 已暂停时恢复播放位置但保持暂停。
- 播放成功后重置失败次数，尝试耗尽后提示刷新重试。
- 签发请求返回 401 时引导回登录页 [[session-8](session.md#session-8)]，其他签发错误就地展示。

### course-access-15

当用户点击“开始观看”时，课程页应在按钮等待期间向签发接口申请播放地址 [[course-access-1](#course-access-1)]：

- 成功后显示带播放控件的视频并尝试播放，浏览器阻止自动播放时提示用户手动开始。
- 失败时恢复按钮、展示错误并允许重试，会话失效时引导回登录页 [[session-8](session.md#session-8)]。

## 内部行为

### course-access-17

当课程页或直调签发接口检查当前用户能否取得新地址时，两者应使用 `src/playback.js` 中的同一项观看资格检查 [[course-access-1](#course-access-1)]。

### course-access-12

当学堂签发或核验播放地址时，学堂应使用数据库中持久化的播放密钥 [[operations-6](operations.md#operations-6)] 对十进制课程编号、英文冒号与十进制到期毫秒时间戳拼成的字符串计算 HMAC-SHA256：

- URL 形如 `/media/:id?expires=<毫秒时间戳>&signature=<64 位小写十六进制签名>`，接收的时间戳包含 1 至 15 个十进制数字。
- 先校验签名，再将时间戳不晚于当前时间的地址判定为到期。

## 验证

### course-access-7

当对学堂执行签发集成测试时，测试应以无效编号、未登录、已登录且课程未发布或不存在、已登录且课程已发布、课程取消发布后等情形请求播放地址，并核对状态码、是否返回地址及到期时间 [[course-access-1](#course-access-1)]。

### course-access-8

当对学堂执行课程页集成测试时，测试应分别以未登录和已登录身份打开课程详情页，核对观看入口与页面中不含播放地址 [[course-access-2](#course-access-2)]。

### course-access-9

当对学堂执行媒体读取集成测试时，测试应使用真实签发的地址在不带会话时读取视频，核对不同范围和 HEAD 的响应 [[course-access-13](#course-access-13)]，取消发布后仍可读取且缺失视频返回 404 [[course-access-3](#course-access-3)]，并核对签名覆盖课程编号和到期时间 [[course-access-12](#course-access-12)] 以及签名被改动或缺失时返回 403 [[course-access-4](#course-access-4)]。

### course-access-10

当对学堂执行素材隔离集成测试时，测试应按文件名和目录穿越路径直接请求视频，并核对响应中没有视频内容 [[course-access-5](#course-access-5)]。

### course-access-11

当对学堂执行浏览器续播系统测试时，测试应在旧播放地址到期后确认它返回 410 [[course-access-4](#course-access-4)]，并断言视频读取失败后课程页获取新地址并恢复当前进度 [[course-access-6](#course-access-6)]，暂停状态、重试上限及失败提示符合约定 [[course-access-14](#course-access-14)]。

### course-access-16

当浏览器系统测试点击“开始观看”时，测试应断言课程页调用签发接口、成功后显示视频并开始播放或提示手动播放，以及失败后恢复按钮和提示正确 [[course-access-15](#course-access-15)]。

### course-access-18

当用登录状态及发布状态矩阵执行双入口集成验证时，测试应核对页面和签发接口的观察结果与两条请求路径共用的资格检查一致 [[course-access-17](#course-access-17)]。
