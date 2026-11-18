<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# course-record: 课程记录

## 意图

定义课程资料、发布状态和所选视频在创建、维护与使用课程时的共同含义。

## 外部行为

### course-record-1

当学堂提供课程资料时，各入口应按同一课程编号解释字段：

| 字段 | 含义 |
| --- | --- |
| `id`、`title`、`summary`、`description`、`instructor` | 唯一的整数课程编号、标题、简介、介绍、讲师 |
| `level`、`levelLabel` | 难度代码与中文标签：`beginner` / 入门、`intermediate` / 进阶、`advanced` / 高级 |
| `durationSeconds` | 所选视频对应的课程时长，以非负整数秒表示 [[course-record-4](#course-record-4)] |
| `published` | 布尔发布标志，`true` 表示已发布，`false` 表示草稿 |
| `createdAt`、`updatedAt` | 创建、最近一次修改的整数毫秒时间戳，新建时均为创建时刻 |
| `url`、`coverUrl` | 根据该编号生成的详情路径 `/courses/:id` 和封面路径 `/covers/:id.svg` |

### course-record-2

当学堂按课程的当前发布状态决定公开可见性和能否为它授予新播放地址时，应采用以下规则：

| 当前状态 | 公开列表和公开详情 | 新播放授权 |
| --- | --- | --- |
| 已发布 | 列入目录，详情可见 | 满足发布条件，仍须通过观看资格检查 |
| 草稿（含取消发布） | 不列入目录，详情不可见 | 不得签发 |

### course-record-3

当学堂列举可供课程选择的视频时，应从 `media/` 选取文件名匹配 `^[a-z0-9][a-z0-9-]{0,80}\.mp4$` 的条目，并提供文件名、字节数和从 MP4 头部读取后四舍五入到整数秒的时长：

- 时长无法解析时仍列出条目，时长为 `null`。
- 目录不存在时可选清单为空。

### course-record-4

当课程选择或更换视频时，学堂应只接受可选清单中的文件名 [[course-record-3](#course-record-3)]，将该名称作为课程当前关联的视频，并将课程时长同步为所选视频的整数秒数，时长未知时记为 0。

### course-record-5

当学堂接收课程文本字段时，应只接受字符串，将 CRLF 和 CR 转为 LF，去除两端空白后按 Unicode 码点校验：

| 字段 | 可为空 | 最长码点数 |
| --- | --- | --- |
| `title` | 否 | 80 |
| `summary` | 否 | 200 |
| `description` | 是 | 5000 |
| `instructor` | 否 | 40 |

## 验证

### course-record-6

当集成测试创建、修改并读回三种难度的课程时，应核对整数课程编号唯一、文本、难度与标签、时长为非负整数秒、发布标志类型、派生路径及创建与更新时间的含义 [[course-record-1](#course-record-1)]。

### course-record-7

当集成测试将同一门草稿课程发布再取消发布时，应在三个状态分别经公开列表、公开详情与已登录用户的新授权请求核对可见性和签发结果 [[course-record-2](#course-record-2)]。

### course-record-8

当集成测试在目录缺失及含有合法名、非法名、可读时长和未知时长文件的环境中维护课程时，应核对清单成员、大小和时长 [[course-record-3](#course-record-3)]，并核对选择、更换视频后的关联名与派生时长、拒绝清单外名称及失败后原关联仍可读 [[course-record-4](#course-record-4)]。

### course-record-9

当集成测试通过课程写入入口提交各文本字段时，应核对非字符串、空白文本、含 CRLF 与 CR 的文本、含补充平面字符的恰达及超过长度上限的文本各自的整理结果或字段错误 [[course-record-5](#course-record-5)]。
