<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# snapshots: 数据库快照

## 意图

规定备份与恢复共用的 SQLite 快照验收标准及副本命名。

## 外部行为

### snapshots-1

当快照工具检查备份来源或恢复快照时，工具应仅接受 SQLite 快速完整性检查只返回 `ok` 且含有 `schema_migrations`、`settings`、`users`、`courses` 表的库，并返回账号、课程、迁移数。

### snapshots-2

当快照工具为指定用途保存数据库副本时，工具应使用用途前缀，非默认数据目录附加目录名标签，随后加本地 `YYYYMMDD-HHMMSS` 时间和 `.sqlite` 后缀，遇到重名时通过编号选用新文件且任何情况下不得覆盖旧备份。

## 验证

### snapshots-3

当集成测试检查完好库、损坏文件及缺少任一必需表的库时，测试应断言仅完好库通过检查且三项统计与库中记录一致 [[snapshots-1](#snapshots-1)]。

### snapshots-4

当集成测试从默认与非默认数据目录连续保存同秒副本时，测试应核对前缀、目录标签、时间及后缀，并断言重名副本有不同编号且原副本内容不变 [[snapshots-2](#snapshots-2)]。
