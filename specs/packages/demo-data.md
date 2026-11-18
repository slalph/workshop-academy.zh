<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# demo-data: 示例数据

## 意图

规定新学堂初始化时提供的账号、课程与播放密钥。

## 外部行为

### demo-data-1

当示例账号初始化时，数据库应提供下列账号，初始密码均为 `123456`：

| 用户名 | 显示名 | 角色 |
| --- | --- | --- |
| `admin` | 王教务 | `admin` |
| `student` | 李小明 | `student` |
| `student2` | 陈小红 | `student` |

### demo-data-2

当示例课程初始化时，数据库应依次提供下列课程：

| 课程 | 视频 | 时长（秒） | 初始状态 |
| --- | --- | --- | --- |
| Python 入门：写出第一个程序 | `python-basics.mp4` | 18 | 发布 |
| 用 Git 管好每一次修改 | `git-essentials.mp4` | 20 | 发布 |
| Web 接口设计与测试 | `web-api-testing.mp4` | 22 | 发布 |
| SQLite 数据建模实践 | `sqlite-modeling.mp4` | 16 | 草稿 |

### demo-data-3

当一个数据库首次初始化示例数据时，学堂应为该库生成随机播放签名密钥并持久化，后续启动沿用该密钥。

## 验证

### demo-data-4

当系统测试分别启动两个新数据目录并重启其中一个时，测试应通过真实登录核对三个账号的密码、显示名与角色 [[demo-data-1](#demo-data-1)]，按创建顺序核对四门课程的标题、视频、时长和发布状态 [[demo-data-2](#demo-data-2)]，并断言两库的播放密钥不同且重启保留原密钥 [[demo-data-3](#demo-data-3)]。
