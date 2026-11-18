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

如果库中没有初始化完成标记，当启动流程开始初始化时，学堂应在同一事务内写入三个示例账号 [[demo-data-1](demo-data.md#demo-data-1)]、四门示例课程 [[demo-data-2](demo-data.md#demo-data-2)]、该库的播放签名密钥 [[demo-data-3](demo-data.md#demo-data-3)] 和完成标记。

### operations-7

当客户端调用 `GET /api/health` 时，学堂应返回 200 和 `{"ok":true,"migrations":{"applied":[...],"pending":[...]}}`，报告已执行及待执行的迁移文件名 [[operations-8](#operations-8)]。

### operations-8

当学堂检查数据库版本时，学堂应以项目 `migrations/` 目录与数据库历史的比较结果 [[migration-history-1](migration-history.md#migration-history-1)] 报告已执行和待执行文件，或报告冲突。

### operations-9

当学堂应用项目迁移时，学堂应将当前数据库和项目迁移目录交给迁移执行器，采用其逐文件提交、遇错停止的结果 [[migration-history-2](migration-history.md#migration-history-2)]。

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
- 当前数据库若存在则先生成恢复前备份 [[operations-15](#operations-15)]，然后用快照原子替换当前数据库文件并清除旧 SQLite 附属日志。
- 输出恢复结果、数据统计、已有恢复前备份位置及必要的待执行迁移提醒 [[operations-8](#operations-8)]，服务保持停止。

### operations-14

当维护命令验收备份来源或恢复快照时，命令应按同一 SQLite 完整性与必需表规则取得统计 [[snapshots-1](snapshots.md#snapshots-1)]，检查失败则中止操作。

### operations-15

当维护命令保存数据库备份时，命令应在配置的备份目录 [[operations-2](#operations-2)] 以 `academy` 标识普通备份、以 `before-restore` 标识恢复前备份，按目录标签与时间命名并保留已有副本 [[snapshots-2](snapshots.md#snapshots-2)]。

### operations-16

当启动成功时，`npm start` 应打印访问地址、数据目录和示例账号说明。

### operations-17

当操作者为示例环境生成素材时，`scripts/make-media.sh` 应借助 ffmpeg 的 libx264 与 Python Pillow 生成示例课程清单中的四个本地 MP4 [[demo-data-2](demo-data.md#demo-data-2)]。

### operations-23

当服务启动或维护命令失败时，命令应打印中文原因并以非零状态退出。

### operations-24

当贡献者编写数据库结构变更时，贡献者应追加编号比现有迁移文件更大的迁移 [[operations-8](#operations-8)]，保留已有数据并将事务控制交给迁移执行器 [[operations-9](#operations-9)]。

## 内部行为

### operations-18

当学堂持久化本地数据时，学堂应使用开启外键约束的 SQLite 保存设置、账号、会话、课程和迁移历史：

- 账号以整数主键关联会话，用户名唯一，角色仅为管理员或学员，删除账号时级联删除会话。
- 课程以整数主键标识，按课程记录约束保存难度、时长、发布状态与创建和更新时间 [[course-record-1](course-record.md#course-record-1)]。

## 验证

### operations-19

当系统测试以独立临时数据目录执行启动、并行启动、正常退出和异常退出后的重启时，测试应断言运行环境和监听设置 [[operations-1](#operations-1)]、文件位置 [[operations-2](#operations-2)]、占用互斥与过期记录清理 [[operations-3](#operations-3)]、不同数据库状态的启动结果 [[operations-4](#operations-4)]、正常退出关闭数据库并释放记录 [[operations-5](#operations-5)]、重启保留已经初始化的示例 [[operations-6](#operations-6)]、成功启动的输出 [[operations-16](#operations-16)]，以及失败命令的输出与退出状态 [[operations-23](#operations-23)]。

### operations-20

当系统测试在真实数据库中添加迁移、修改历史文件或在迁移中途触发失败时，测试应断言健康检查报告 [[operations-7](#operations-7)]、文件与历史约束 [[operations-8](#operations-8)]、每文件原子性及保留旧数据 [[operations-9](#operations-9)]、服务运行时禁止迁移且停服后可执行 [[operations-10](#operations-10)]，以及新增更大编号迁移能在保留已有数据的同时演进结构 [[operations-24](#operations-24)]。

### operations-21

当系统测试在运行中或停止后用操作命令备份和恢复真实数据库时，测试应断言维护令牌校验及停服 [[operations-11](#operations-11)]、备份完整且服务保持停止 [[operations-12](#operations-12)]、恢复条件和前后数据库内容 [[operations-13](#operations-13)]、无效快照在替换前被拒绝 [[operations-14](#operations-14)]，以及命名和防覆盖 [[operations-15](#operations-15)]。

### operations-22

当系统测试用生成脚本准备示例素材后启动学堂时，测试应断言四个生成的视频均为可读的 MP4 且对应示例课程 [[operations-17](#operations-17)]。

### operations-25

当集成测试在学堂创建的数据库中写入、重开并删除记录时，测试应核对设置、账号、会话、课程和迁移历史的持久化，验证整数主键、账号唯一性、角色限制、会话外键与级联删除，并核对课程难度、非负时长、二值发布状态和毫秒时间戳 [[operations-18](#operations-18)]。

### operations-26

当系统测试分别启动未初始化、有初始化写入冲突和已初始化的数据库时，测试应断言首次成功写入账号、课程、密钥和完成标记，中途失败时四者均无部分写入，成功后重启保持用户修改并保留原标记 [[operations-6](#operations-6)]。
