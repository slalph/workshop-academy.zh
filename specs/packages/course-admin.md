<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# course-admin: 课程管理

## 意图

规定管理员查看、创建、编辑、发布和取消发布课程以及选择本地视频的行为。

## 外部行为

### course-admin-1

当客户端访问 `/admin`、`/admin/courses/new`、`/admin/courses/:id/edit` 或 `/api/admin/` 下已定义的管理接口时，学堂应在执行管理操作前应用管理员入口权限 [[session-7](session.md#session-7)]。

### course-admin-2

当管理员请求 `GET /api/admin/courses` 时，学堂应返回 200 和 `{"courses":[...]}`，包含按编号升序排列的全部课程及其管理字段 [[course-admin-3](#course-admin-3)]。

### course-admin-3

当学堂在管理接口序列化课程时，学堂应返回课程资料与链接 [[course-record-1](course-record.md#course-record-1)]（`id`、`title`、`summary`、`description`、`instructor`、`level`、`levelLabel`、`durationSeconds`、`published`、`updatedAt`、`url`、`coverUrl`），并附上当前关联的 `videoFile` [[course-record-4](course-record.md#course-record-4)] 和创建时间戳 `createdAt`。

### course-admin-4

当管理员请求 `GET /api/admin/courses/:id` 时，学堂应对有效编号 [[request-contract-2](request-contract.md#request-contract-2)] 对应的任意既存课程返回 200 和 `{"course": {...}}` [[course-admin-3](#course-admin-3)]，其余返回 404。

### course-admin-5

当管理员向 `POST /api/admin/courses` 提交有效数据 [[course-admin-7](#course-admin-7)] 时，学堂应创建一门课程并返回 201 和 `{"course": {...}}` [[course-admin-3](#course-admin-3)]，创建时间与更新时间均为当时的毫秒时间戳。

### course-admin-6

当管理员向 `PATCH /api/admin/courses/:id` 提交有效数据 [[course-admin-7](#course-admin-7)] 时，学堂应仅修改指定的既存课程 [[course-admin-4](#course-admin-4)] 的提交字段及其派生值和更新时间，返回 200 和 `{"course": {...}}` [[course-admin-3](#course-admin-3)]。

### course-admin-7

当学堂校验课程写入的 JSON 对象 [[request-contract-1](request-contract.md#request-contract-1)] 时，学堂应按操作及字段规则验证可写数据：

- 新建时必填 `title`、`summary`、`instructor`、`level` 和 `videoFile`，未提供的 `description` 和 `published` 分别取空字符串和 `false`。
- 文本按字段整理并校验长度 [[course-record-5](course-record.md#course-record-5)]，`level` 仅接受三种难度代码，`published` 仅接受布尔值 [[course-record-1](course-record.md#course-record-1)]。
- `videoFile` 仅接受可选素材的文件名，并用所选视频更新课程时长 [[course-record-4](course-record.md#course-record-4)]。
- 修改时仅校验出现的字段，空对象返回 400。
- 出现未知字段时返回 400，已知字段的校验错误以 400 和逐字段中文 `fields` 返回。

### course-admin-8

当管理员请求 `GET /api/admin/videos` 时，学堂应返回 200 和 `{"videos":[...]}`，按文件名升序列出本地可选素材 [[course-record-3](course-record.md#course-record-3)]：

- 每项含文件名 `file`、大小 `sizeBytes`、按 MP4 头部总时长四舍五入到整数秒后的 `durationSeconds`。
- 无法解析时长时使用 `null`，目录不存在时返回空列表。

### course-admin-9

当管理员打开 `/admin` 时，学堂应显示所有课程 [[course-admin-2](#course-admin-2)] 及全部、已发布和草稿的数量，并提供新建、编辑、发布状态切换和已发布课程公开详情 [[catalog-2](catalog.md#catalog-2)] 的入口。

### course-admin-10

当管理员在管理列表切换发布状态时，页面应提交对应的发布状态修改 [[course-admin-6](#course-admin-6)]，按接口返回更新该课程行和统计，并显示结果消息：

- 成功时更新徽标、按钮、更新时间和公开浏览入口 [[catalog-2](catalog.md#catalog-2)]，并说明发布或取消发布对目录可见性及新播放授权的影响 [[course-record-2](course-record.md#course-record-2)]。
- 失败时保持课程行状态并显示错误。

### course-admin-11

当管理员打开新建或编辑页面时，学堂应提供全部可写字段 [[course-admin-7](#course-admin-7)] 的表单：

- 编辑时按课程编号读取任意既存课程 [[course-admin-4](#course-admin-4)]，用当前值填充表单，课程无效时为 404。
- 浏览器从视频接口 [[course-admin-8](#course-admin-8)] 装入含文件名、时长与大小的选项，并提示列表为空、加载失败或原文件缺失。

### course-admin-12

当管理员提交新建或编辑表单时，页面应将新建请求 [[course-admin-5](#course-admin-5)] 或编辑请求 [[course-admin-6](#course-admin-6)] 的结果反馈给管理员：

- 必填项缺失或出现服务端字段错误时显示中文提示，并聚焦首个出错字段。
- 成功后回到管理列表并按课程显示已创建或已更新的提示。

## 验证

### course-admin-13

当集成测试直接请求管理页面与接口并使用三种身份时，测试应断言权限结果与后端权限一致 [[course-admin-1](#course-admin-1)]，管理员列表含草稿且排序正确 [[course-admin-2](#course-admin-2)]，课程管理字段完整 [[course-admin-3](#course-admin-3)]，有效及无效编号的详情正确 [[course-admin-4](#course-admin-4)]。

### course-admin-14

当集成测试经真实接口新建和修改课程时，测试应断言新建、草稿默认值和返回数据 [[course-admin-5](#course-admin-5)]，局部修改与时间更新 [[course-admin-6](#course-admin-6)]，每类字段校验及视频时长派生 [[course-admin-7](#course-admin-7)]，以及视频列表顺序、文件名、大小、可读时长与空列表 [[course-admin-8](#course-admin-8)]。

### course-admin-15

当系统测试在管理页面建课、编辑及切换发布状态时，测试应断言课程行、统计及入口 [[course-admin-9](#course-admin-9)]，成功或失败的发布反馈及公开状态 [[course-admin-10](#course-admin-10)]，新建和编辑表单及视频选项 [[course-admin-11](#course-admin-11)]，提交后的错误定位或成功通知 [[course-admin-12](#course-admin-12)]。
