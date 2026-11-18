<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# session: 账号与会话

## 意图

规定访客登录、换账号、查询和退出会话，以及受保护入口如何区分访客和两类账号。

## 外部行为

### session-1

当客户端向 `POST /api/login` 提交 JSON 对象 [[web-4](web.md#web-4)] 时，学堂应按下表处理凭据：

| 情形 | 结果 |
| --- | --- |
| 用户名非字符串或去除两端空白后为空，或密码非字符串或为空 | 400 和缺失或无效字段的中文 `fields` |
| 用户名原始长度超过 64 个 UTF-16 码元、密码超过 200 个 UTF-16 码元、账号不存在或密码错误 | 401 和统一的凭据错误消息 |
| 去除用户名两端空白后得到的账号与原样密码匹配 | 200 和 `{"user": {...}}` [[session-2](#session-2)]，注销请求携带的旧会话后签发新会话 [[session-3](#session-3)] |

### session-2

当学堂公开会话用户时，学堂应仅返回 `id`、`username`、`displayName` 和 `role`，其中角色为 `admin` 或 `student`。

### session-3

当学堂签发会话时，学堂应通过 `academy_session` cookie 交付随机令牌，设置 `Path=/`、`HttpOnly`、`SameSite=Lax` 和 12 小时的 `Max-Age`，其服务端有效期从签发起计为 12 小时。

### session-4

当学堂识别请求身份时，学堂应仅承认 `academy_session` 中对应既存且尚未到期会话的 64 位小写十六进制令牌。

### session-5

当客户端打开 `GET /api/session` 时，学堂应返回 200 和 `{"user": ...}`，其中有效会话 [[session-4](#session-4)] 返回公开用户 [[session-2](#session-2)]，其余返回 `null`。

### session-6

当客户端向 `POST /api/logout` 提交请求时，学堂应撤销请求携带的当前会话，返回 200 和 `{"ok":true}`，并用空值和 `Max-Age=0` 清除会话 cookie [[session-3](#session-3)]。

### session-7

当学堂判断一个管理员入口的访问权限时，学堂应按入口类型处理会话身份 [[session-4](#session-4)]：

| 会话身份 | 接口 | 页面 |
| --- | --- | --- |
| 访客 | 401 | 302 到登录页，`next` 包含原路径和查询串 [[session-8](#session-8)] |
| 学员 | 403 | 403，含返回目录和换账号登录的错误页 [[web-6](web.md#web-6)] [[session-8](#session-8)] |
| 管理员 | 执行请求 | 展示请求页面 |

### session-8

当浏览器打开 `/login` 时，学堂应根据当前会话 [[session-4](#session-4)]、`switch` 与安全的返回地址 [[session-9](#session-9)] 决定结果：

| 情形 | 结果 |
| --- | --- |
| 已登录且 `switch` 不等于 `1` | 302 到安全的返回地址 |
| 访客或 `switch=1` | 200，显示用户名、密码和示例账号入口 [[operations-6](operations.md#operations-6)]，已登录时说明当前身份和会话替换 |

### session-9

当学堂选择登录后的返回地址时，学堂应接受不超过 512 个 UTF-16 码元、以单个斜杠开头且不含反斜杠或控制字符的站内路径，拒绝 `/login`、以 `/login?` 或 `/api/` 开头的值，并对其他不合规则的值使用 `/`。

### session-10

当用户在登录表单手动提交或选择示例账号时，登录页应通过登录接口 [[session-1](#session-1)] 提交凭据并在成功后转到安全返回地址 [[session-9](#session-9)]：

- 选择示例账号时自动填入示例用户名和密码再提交 [[operations-6](operations.md#operations-6)]。
- 缺少凭据或返回字段错误时在对应字段展示消息并聚焦首个出错字段。
- 凭据不匹配时提示失败并聚焦密码字段。

### session-11

当已登录用户点击站点顶栏的退出按钮 [[web-7](web.md#web-7)] 时，页面应调用退出接口 [[session-6](#session-6)] 并在成功后回到目录，在失败时显示错误并允许重试。

## 内部行为

### session-12

当学堂创建或比较本地账号的密码凭据时，学堂应使用带盐的 scrypt 散列与恒定时间比较，并对未知账号的可校验密码执行等量散列。

### session-13

当学堂创建会话 [[session-3](#session-3)] 时，学堂应生成 32 字节随机令牌，仅持久化其 SHA-256 摘要，并清理已到期会话。

## 验证

### session-14

当集成测试使用真实登录、查询、换账号和退出接口时，测试应断言输入校验和凭据错误不签发会话 [[session-1](#session-1)]，用户对象不含凭据 [[session-2](#session-2)]，cookie 与期限正确 [[session-3](#session-3)]，旧会话失效而新会话有效 [[session-4](#session-4)]，查询返回当前用户或空值 [[session-5](#session-5)]，退出清除会话且可对访客调用 [[session-6](#session-6)]，数据库不含原始令牌且新建会话清理过期记录 [[session-13](#session-13)]，以及账号凭据持久化为带盐的散列 [[session-12](#session-12)]。

### session-15

当系统测试以访客、学员和管理员访问管理入口及登录页时，测试应断言各入口的许可、拒绝和跳转 [[session-7](#session-7)]，已登录用户的默认跳转及显式切换表单 [[session-8](#session-8)]，合法站内及不合法返回地址的处理 [[session-9](#session-9)]，以及页面手动登录、示例登录、出错定位 [[session-10](#session-10)] 和退出 [[session-11](#session-11)]。
