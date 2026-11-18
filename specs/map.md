<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->
<!-- spex-i18n-source: map.md sha256-5dbf6d5bf1f09c74f8bf71209986eca460723957c6861f0a73654b88d9e522d9 -->

# 规约地图

用于快速定位决策和规约包的索引。
规约条目是事实来源。
开发过程中，代码可能与规约暂时不一致。

## 编写和审阅规约

在编写、修改或审阅 DR、IR 或条目前，先了解 [`meta.md`](meta.md) 中的规则。

## 目录结构

```text
decisions/    决策记录（DRs）
intents/      意图记录（IRs）
packages/     规约包（每包一个文件）
map.md        本索引
meta.md       规约的规约
```

## 决策

| ID | 文件 | 摘要 |
| --- | --- | --- |
| [DR-000](decisions/000-spec-structure-format.md) | 000-spec-structure-format.md | 规约结构、格式和命名约定 |

## 规约包

| 文件 | 到这里查什么 |
| --- | --- |
| [catalog.md](packages/catalog.md) | 访客浏览目录、课程详情及封面 |
| [course-admin.md](packages/course-admin.md) | 管理员维护课程、选择视频与发布课程 |
| [course-access.md](packages/course-access.md) | 签发播放地址、展示入口、媒体读取和续播 |
| [course-record.md](packages/course-record.md) | 课程记录的共同字段、公开可见性与视频关联 |
| [session.md](packages/session.md) | 登录、换账号、会话及角色准入 |
| [web.md](packages/web.md) | HTTP 响应、静态资源、错误表示和站点导航 |
| [request-contract.md](packages/request-contract.md) | 通用 JSON 对象、资源编号与 GET/HEAD 读取约定 |
| [operations.md](packages/operations.md) | 本机服务和维护命令的入口与结果 |
| [demo-data.md](packages/demo-data.md) | 首次初始化提供的示例身份、课程与签名密钥 |
| [migration-history.md](packages/migration-history.md) | 校验迁移历史及逐文件事务执行 |
| [snapshots.md](packages/snapshots.md) | 检查数据库快照和保存唯一的备份副本 |
| [git.md](packages/git.md) | 提交信息和 AI 共同作者署名 |
| [licensing.md](packages/licensing.md) | SPDX 许可头的适用范围与检查 |
