<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# catalog: 公开课程目录

## 意图

规定无须登录可发现的课程、公开课目信息、详情页和封面。

## 外部行为

### catalog-1

当客户端打开 `GET /api/courses` 时，学堂应返回 200 和 `{"courses":[...]}`，包含按编号升序排列的所有公开可见的已发布课程 [[course-record-2](course-record.md#course-record-2)] [[catalog-3](#catalog-3)]。

### catalog-2

当客户端打开 `GET /api/courses/:id` 或 `/courses/:id` 时，学堂应仅为编号有效 [[request-contract-2](request-contract.md#request-contract-2)] 且公开可见 [[course-record-2](course-record.md#course-record-2)] 的已发布课程返回 200 和相应课程详情：

| 路径 | 详情 |
| --- | --- |
| `/api/courses/:id` | `{"course": {...}}` [[catalog-3](#catalog-3)] |
| `/courses/:id` | 显示课程资料的页面 [[catalog-5](#catalog-5)] |

- 课程为草稿或不存在时返回相应格式的 404 [[web-6](web.md#web-6)]。

### catalog-3

当学堂序列化公开课程时，学堂应按课程资料及链接的定义 [[course-record-1](course-record.md#course-record-1)] 返回以下公开字段：

- `id`、`title`、`summary`、`description`、`instructor`、`durationSeconds`、布尔值 `published`、毫秒时间戳 `updatedAt`。
- `level` 和 `levelLabel` 分别为 `beginner` / 入门、`intermediate` / 进阶或 `advanced` / 高级。
- `url` 为 `/courses/:id`，`coverUrl` 为 `/covers/:id.svg` [[catalog-6](#catalog-6)]。

### catalog-4

当浏览器打开 `/` 时，学堂应展示已发布课程目录 [[catalog-1](#catalog-1)]：

- 显示课程数量、视频总时长，以及带有封面、编号、难度、时长、标题、简介和讲师的可导航课程卡片 [[catalog-3](#catalog-3)] [[catalog-6](#catalog-6)]。
- 无已发布课程时显示空目录提示。
- 访客可前往登录 [[session-8](session.md#session-8)] 或直接跳到课程列表。

### catalog-5

给定课程已发布，当浏览器打开该课程详情页 [[catalog-2](#catalog-2)] 时，课程详情页应在站点外壳中 [[web-7](web.md#web-7)] 展示课程资料 [[catalog-3](#catalog-3)]：

- 显示返回目录的面包屑、课程标题、简介、编号、难度、讲师、时长与本地更新日期。
- 介绍按空行分段，文本按 HTML 上下文转义 [[web-8](web.md#web-8)]。
- 视频区展示封面 [[catalog-6](#catalog-6)] 并按观看资格提供观看入口 [[course-access-2](course-access.md#course-access-2)]。

### catalog-6

当客户端打开 `GET /covers/:id.svg` 时，学堂应为任意有效正整数编号 [[request-contract-2](request-contract.md#request-contract-2)] 提供由编号确定的像素风格 SVG，以 `image/svg+xml` 响应并允许公开缓存 3600 秒。

## 验证

### catalog-7

当集成测试经公开列表和详情入口读取真实已发布课程、草稿、无效编号和不存在编号时，测试应断言列表仅含已发布课程且按编号排序 [[catalog-1](#catalog-1)]，详情状态码及表示正确 [[catalog-2](#catalog-2)]，公开字段、难度标签、链接和时间戳正确 [[catalog-3](#catalog-3)]。

### catalog-8

当系统测试在浏览器查看已发布、无已发布课程以及含特殊字符的课程时，测试应断言目录的卡片、统计、访客入口和空状态 [[catalog-4](#catalog-4)]，以及详情页的课程资料、分段、封面和观看区域 [[catalog-5](#catalog-5)]。

### catalog-9

当集成测试请求相同和不同编号的封面时，测试应断言响应类型、公开缓存、同一编号内容稳定以及未对应课程的有效编号仍有封面 [[catalog-6](#catalog-6)]。
