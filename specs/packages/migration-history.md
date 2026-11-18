<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# migration-history: 数据库迁移历史

## 意图

规定迁移执行器如何判定数据库版本，以及每次结构变更的提交边界。

## 外部行为

### migration-history-1

当执行器比较迁移目录与数据库历史时，执行器应按文件名排序检查全部 `.sql` 文件，返回已执行与待执行的文件名或报告冲突：

- 文件名形如 `001-init.sql`，编号至少三位且唯一，短名由小写字母、数字和连字符构成且以字母或数字开始。
- 已执行文件的名称和 SHA-256 校验和须匹配记录。
- 删除、改名、修改已执行文件，或将新文件排在已执行文件之前，均为冲突。

### migration-history-2

当执行器接到迁移请求时，执行器应仅在历史检查无冲突后按顺序执行待迁移文件 [[migration-history-1](#migration-history-1)]，将每个文件的更改及其名称、校验和、执行时间在同一 SQLite 事务内提交，遇到失败则回滚该文件，保留先前已提交的文件并停止执行。

## 验证

### migration-history-3

当集成测试用临时 SQL 目录和真实数据库比较迁移历史时，测试应断言有序的已执行与待执行清单，并逐例断言非法命名、重复编号、插入历史、删除、改名及校验和不符均产生冲突 [[migration-history-1](#migration-history-1)]。

### migration-history-4

当集成测试在真实数据库连续应用多个迁移且中间文件执行失败时，测试应核对先前文件的数据、结构与历史记录均已提交，失败文件的更改和记录均回滚，后续文件尚未执行 [[migration-history-2](#migration-history-2)]。
