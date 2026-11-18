<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# operations: 本地运维与数据库

## 意图

规定本地运行环境、数据目录所有权、数据库初始化和迁移，以及备份与恢复。

## 外部行为

### operations-1

当操作者从项目运行 `npm start` 时，学堂应使用 Node.js 24 或更新版本直接启动，无需安装 npm 依赖、构建或联网，并仅监听 `127.0.0.1`，端口取 `PORT` 中 0 至 65535 的整数，缺省为 3000，取 0 时由操作系统分配。

### operations-2

当操作者运行学堂或维护命令时，命令应使用 `DATA_DIR` 指定或默认在项目 `data/` 的数据目录，以 `academy.sqlite` 持久化数据，以 `run.json` 记录数据目录占用，并将备份保存到 `BACKUP_DIR` 指定或默认在项目 `backups/` 的目录。

### operations-3

当服务或维护命令占用数据目录时，学堂应以权限 0600 独占该目录的 `run.json`，记录进程号、开始时间和运行服务的地址及维护令牌或维护任务名：

- 已有存活进程时拒绝再次占用并报告该进程，服务拒绝时给出已知地址。
- 已有记录无法识别或进程已经退出时清理记录再尝试取得所有权。

### operations-4

当学堂启动并检查数据库时，学堂应按数据库状态决定能否继续：

| 情形 | 结果 |
| --- | --- |
| 新库或没有任何表的库 | 执行全部迁移 [[operations-9](#operations-9)] 后初始化 [[operations-6](#operations-6)] |
| 现有库的迁移均已执行且一致 [[operations-8](#operations-8)] | 保留数据并启动，对从未初始化的库填入示例数据 [[operations-6](#operations-6)] |
| 现有库有待执行的迁移 [[operations-8](#operations-8)] | 拒绝启动，列出待执行文件并提示依次备份 [[operations-12](#operations-12)]、迁移 [[operations-10](#operations-10)]、启动 |
| 迁移文件与数据库记录不一致 [[operations-8](#operations-8)] | 拒绝启动并报告冲突 |

### operations-5

当操作者正常停止服务（SIGINT、SIGTERM 或获准的维护请求 [[operations-11](#operations-11)]）时，学堂应停止接收连接，给正在处理的请求至多约两秒时间结束，然后关闭数据库并释放运行记录 [[operations-3](#operations-3)]。

### operations-6

如果数据库从未填入示例数据，当学堂完成启动前的迁移检查 [[operations-4](#operations-4)] 后，学堂应原子初始化本地示例：

- 创建 `admin`（王教务、管理员）、`student`（李小明、学员）、`student2`（陈小红、学员），示例密码均为 `123456`，创建后可通过登录接口使用这些账号 [[session-1](session.md#session-1)]。
- 生成随机播放签名密钥并持久化初始化完成标记。
- 依次创建四门示例课程，前三门发布，末门为草稿：

| 课程 | 视频 | 时长（秒） | 讲师 | 难度 | 一句话简介 |
| --- | --- | ---: | --- | --- | --- |
| Python 入门：写出第一个程序 | `python-basics.mp4` | 18 | 林知远 | 入门 | 从变量、条件和循环开始，用一个猜数字小游戏把基础语法串起来。 |
| 用 Git 管好每一次修改 | `git-essentials.mp4` | 20 | 周若溪 | 入门 | 提交、分支与合并：在团队里放心地改代码，出错也能找回来。 |
| Web 接口设计与测试 | `web-api-testing.mp4` | 22 | 陈墨 | 进阶 | 用 HTTP 工具直接调用接口，读懂状态码，写出可重复执行的接口测试。 |
| SQLite 数据建模实践 | `sqlite-modeling.mp4` | 16 | 许清 | 进阶 | 从需求出发设计表结构，用迁移脚本安全地演进数据库。 |

| 课程编号 | 初始介绍（按空行分段） |
| --- | --- |
| 1 | 这门课面向从没写过代码的同学。我们先装好 Python，再一步步写出一个能和你对话的猜数字游戏。<br><br>每一节都先演示、再动手：你会认识变量与类型、if 判断、while 循环和函数，并学会读懂报错信息。<br><br>学完后，你能独立写出几十行的小程序，并知道下一步该学什么。 |
| 2 | 把 Git 当成代码的“时光机”。课程从第一次提交讲起，覆盖查看历史、撤销修改、创建分支和合并冲突。<br><br>我们用一个多人协作的小项目演示常见场景：两个人改了同一行怎么办？提交写错了怎么补救？<br><br>课程最后整理一份团队提交约定，可以直接用到你的项目里。 |
| 3 | 页面背后是一组 HTTP 接口。本课教你用 curl 和浏览器开发者工具观察请求与响应，理解方法、路径、状态码和 JSON 结构。<br><br>接着我们设计一组课程接口：哪些需要登录、出错时返回什么、怎样避免越权访问。<br><br>最后把这些约定写成自动化测试，每次修改后一条命令就能确认接口仍然正确。 |
| 4 | 这门课还在准备中，供管理员练习发布流程。<br><br>内容涵盖表与字段设计、约束与索引、编写迁移脚本，以及迁移前后如何备份与核对数据。 |

### operations-7

当客户端调用 `GET /api/health` 时，学堂应返回 200 和 `{"ok":true,"migrations":{"applied":[...],"pending":[...]}}`，报告已执行及待执行的迁移文件名 [[operations-8](#operations-8)]。

### operations-8

当学堂检查迁移状态时，学堂应读取 `migrations/` 下以 `.sql` 结尾的文件并按文件名排序，校验文件格式、编号和历史：

- 文件名形如 `001-init.sql`，编号至少三位且唯一，短名由小写字母、数字和连字符构成且以字母或数字开始。
- 已执行文件的名称和 SHA-256 校验和须匹配记录。
- 新文件须追加在已执行文件之后；删除、改名、修改已执行文件或将新文件排在历史之前均作为冲突。

### operations-9

当学堂应用迁移时，学堂应只对检查无冲突 [[operations-8](#operations-8)] 的待执行文件按文件名顺序逐一运行，并使文件更改及其名称、校验和、执行时间的记录在同一 SQLite 事务内提交；某文件失败则回滚该文件、保留先前已成功文件并停止后续执行。

### operations-10

如果服务已停止且数据目录可独占 [[operations-3](#operations-3)]，当操作者运行 `npm run migrate` 时，命令应应用待执行迁移 [[operations-9](#operations-9)]，在数据库缺失时建库并将示例填入留到首次启动 [[operations-6](#operations-6)]，并报告执行的文件、无需迁移或失败原因。

### operations-11

当客户端调用 `POST /internal/stop` 时，学堂应仅在请求的 `x-maintenance-token` 匹配当前运行记录中的维护令牌 [[operations-3](#operations-3)] 时返回 202 和中文停服消息，并在应答后正常停服 [[operations-5](#operations-5)]，令牌缺失或不匹配时返回 403。

### operations-12

当操作者运行 `npm run backup` 时，命令应在数据库停止写入且通过检查 [[operations-14](#operations-14)] 后创建新备份：

- 服务运行时用运行记录请求正常停止 [[operations-11](#operations-11)]，等待原进程释放运行记录或退出，无法正常停服时备份失败。
- 数据库缺失或数据目录不能独占 [[operations-3](#operations-3)] 时备份失败。
- 输出备份路径、账号、课程及迁移数和可重启原数据目录及端口的命令，服务保持停止。

### operations-13

当操作者运行 `npm run restore -- <备份文件>` 时，命令应在服务停止且数据目录可独占 [[operations-3](#operations-3)] 时从通过检查的快照 [[operations-14](#operations-14)] 恢复：

- 快照路径相对调用命令时的目录解析，拒绝缺失、非文件或当前数据库本身的路径。
- 当前数据库若存在则先生成恢复前备份 [[operations-15](#operations-15)]，然后用快照原子替换当前数据库文件并清除旧 SQLite 附属日志。即使当前主数据库已损坏而无法作为 SQLite 打开，也应先按原字节留存该文件，再从完好快照恢复。同一命令若不能留存旧文件，应在替换前退出。
- 输出恢复结果、数据统计、已有恢复前备份位置及必要的待执行迁移提醒 [[operations-8](#operations-8)]，服务保持停止。

### operations-14

当维护命令验证备份来源或恢复快照时，维护命令应要求 SQLite 快速完整性检查仅返回 `ok`，且库中存在 `schema_migrations`、`settings`、`users`、`courses`。

### operations-15

当维护命令创建备份文件时，命令应使用 `academy` 或 `before-restore` 前缀，非默认数据目录附加目录名标签，随后加本地 `YYYYMMDD-HHMMSS` 时间和 `.sqlite` 后缀，遇到重名时通过编号使用新文件名且任何情况下不得覆盖旧备份。

### operations-16

当启动成功时，`npm start` 应打印访问地址、数据目录和示例账号说明。

### operations-17

当操作者为示例环境生成素材时，`scripts/make-media.sh` 应借助 ffmpeg 的 libx264 与 Python Pillow 生成四个示例课程所用的本地 MP4 [[operations-6](#operations-6)]。

### operations-23

当服务启动或维护命令失败时，命令应打印中文原因并以非零状态退出。

### operations-24

当贡献者编写数据库结构变更时，贡献者应追加编号比现有迁移文件更大的迁移 [[operations-8](#operations-8)]，保留已有数据并将事务控制交给迁移执行器 [[operations-9](#operations-9)]。

## 内部行为

### operations-18

当学堂持久化本地数据时，学堂应使用开启外键约束的 SQLite 保存设置、账号、会话、课程和迁移历史：

- 账号以整数主键关联会话，用户名唯一，角色仅为管理员或学员，删除账号时级联删除会话 [[session-2](session.md#session-2)] [[session-4](session.md#session-4)]。
- 课程以整数主键标识，难度取公开枚举 [[catalog-3](catalog.md#catalog-3)]，时长非负，发布状态为二值 [[course-admin-7](course-admin.md#course-admin-7)]，使用毫秒时间戳保存创建与更新时间 [[course-admin-5](course-admin.md#course-admin-5)] [[course-admin-6](course-admin.md#course-admin-6)]。

## 验证

### operations-19

当系统测试以独立临时数据目录执行启动、并行启动、正常退出和异常退出后的重启时，测试应断言运行环境和监听设置 [[operations-1](#operations-1)]、文件位置 [[operations-2](#operations-2)]、占用互斥与过期记录清理 [[operations-3](#operations-3)]、不同数据库状态的启动结果 [[operations-4](#operations-4)]、正常退出关闭数据库并释放记录 [[operations-5](#operations-5)]、示例只初始化一次且四门课保留规定的讲师、难度、简介与分段正文 [[operations-6](#operations-6)]、成功启动的输出 [[operations-16](#operations-16)]，以及失败命令的输出与退出状态 [[operations-23](#operations-23)]。

### operations-20

当系统测试在真实数据库中添加迁移、修改历史文件或在迁移中途触发失败时，测试应断言健康检查报告 [[operations-7](#operations-7)]、文件与历史约束 [[operations-8](#operations-8)]、每文件原子性及保留旧数据 [[operations-9](#operations-9)]、服务运行时禁止迁移且停服后可执行 [[operations-10](#operations-10)]、SQLite 保存和约束生效 [[operations-18](#operations-18)]，以及新增更大编号迁移能在保留已有数据的同时演进结构 [[operations-24](#operations-24)]。

### operations-21

当系统测试在运行中或停止后用操作命令备份和恢复真实数据库时，测试应断言维护令牌校验及停服 [[operations-11](#operations-11)]、备份完整且服务保持停止 [[operations-12](#operations-12)]、健康和损坏两种当前库的恢复结果、损坏文件的原字节留存和恢复前后课程资料 [[operations-13](#operations-13)]、无效快照在替换前被拒绝 [[operations-14](#operations-14)]，以及命名和防覆盖 [[operations-15](#operations-15)]。

### operations-22

当系统测试用生成脚本准备示例素材后启动学堂时，测试应断言四个生成的视频均为可读的 MP4 且对应示例课程 [[operations-17](#operations-17)]。
