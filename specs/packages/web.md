<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# web: HTTP 与站点外壳

## 意图

规定学堂 HTTP 服务的通用请求校验、错误、静态资源、更安全的浏览器默认值和页面导航。

## 外部行为

### web-1

当学堂处理 HTTP 请求时，学堂应仅接受去除数字端口后匹配 `localhost`、`127.0.0.1` 或 `[::1]` 的 `Host`，匹配忽略大小写，其他情况返回 400。

### web-2

如果请求方法既非 `GET` 也非 `HEAD` 且客户端发送了 `Origin`，当学堂处理该请求时，学堂应在来源与 `http://` 加原请求 `Host` 不完全一致时返回 403。

### web-3

如果请求方法既非 `GET` 也非 `HEAD`，当客户端请求 `/api/` 下的路径时，学堂应要求媒体类型为 `application/json` 并允许类型参数，类型不符或缺失时返回 415。

### web-4

当学堂将请求体交给业务操作时，HTTP 入口应按对象解析结果 [[request-contract-1](request-contract.md#request-contract-1)] 分派：有效对象（含空对象）交给操作，超长返回 413，格式无效返回 400。

### web-5

当学堂解析资源路径中的编号时，路由应将有效编号交给资源操作 [[request-contract-2](request-contract.md#request-contract-2)]，遇到无效编号时统一返回 404。

### web-6

当学堂处理请求错误时，学堂应按路径选择错误表示：

- `/api/`、`/internal/` 和 `/media/` 下使用 UTF-8 JSON，对象含中文 `error`，若有字段错误则另含 `fields`。
- 其他路径使用带站点外壳 [[web-7](#web-7)] 的 UTF-8 HTML，展示状态说明与返回目录的链接，并按身份拒绝的结果 [[session-7](session.md#session-7)] 在 401 或 403 时另给登录或切换账号入口 [[session-8](session.md#session-8)]。
- 未注册路径返回 404；未预期的服务端错误返回 500 和通用中文消息。

### web-7

当学堂呈现页面时，页面应提供简体中文站点外壳，含跳到主要内容的链接、主页和目录导航、管理员专用管理导航 [[session-7](session.md#session-7)]、主区和页脚：

- 已登录时显示公开用户身份 [[session-2](session.md#session-2)] 以及退出入口 [[session-11](session.md#session-11)]。
- 未登录时在非登录页显示登录入口 [[session-8](session.md#session-8)]。

### web-8

当学堂在 HTML 文本或属性中插入用户或课程数据时，页面应对这些动态值作 HTML 转义。

### web-9

当客户端访问已注册的 HTTP 路径时，学堂应允许该路由声明的方法，按读取契约接受对应的无响应体 `HEAD` [[request-contract-3](request-contract.md#request-contract-3)]，并对未声明方法返回 405 和 `Allow` 响应头。

### web-10

当学堂发送 HTTP 响应时，学堂应默认禁用存储缓存，通过 `nosniff` 禁用 MIME 探测、禁止发送引用来源、禁止被嵌套、隔离跨源窗口关系，并通过 CSP 限制资源及表单为同源、允许 `data:` 图片并禁止对象和基准 URL。

### web-11

当客户端请求 `GET /assets/*` 时，学堂应仅从 `public/` 提供已知资源类型的普通文件：

- 允许的扩展名为 `.css`、`.js`、`.svg`、`.png`、`.ico`、`.woff2`、`.json`、`.txt`，匹配忽略大小写。
- 无效编码、隐藏或空路径段、反斜杠、空字节、目录之外的解析路径、不支持的类型或文件缺失返回 404。
- 成功时返回内容类型、`Cache-Control: public, no-cache`、`Last-Modified` 和弱 `ETag`，`If-None-Match` 完全等于当前标签时返回无响应体的 304。

### web-12

当客户端访问 `GET /favicon.ico` 时，学堂应以 301 跳转到 `/assets/favicon.svg` [[web-11](#web-11)]。

## 验证

### web-13

当集成测试对运行中的学堂提交不同 Host、来源、媒体类型及请求体时，测试应断言受支持的 Host 和非法 Host [[web-1](#web-1)]、请求来源验证 [[web-2](#web-2)]、写接口媒体类型 [[web-3](#web-3)]、空值、超限及无效 JSON 对象的状态码 [[web-4](#web-4)]。

### web-14

当集成测试请求有效和无效编号、未注册路由、不支持的方法及 HEAD 时，测试应断言编号规则 [[web-5](#web-5)]、中文 HTML 或 JSON 的错误格式及状态 [[web-6](#web-6)]、允许的方法及响应体 [[web-9](#web-9)] 和默认保护响应头 [[web-10](#web-10)]。

### web-15

当系统测试以访客、学员和管理员加载含特殊字符的页面时，测试应断言站点导航、身份入口及简体中文外壳 [[web-7](#web-7)]，以及动态值以转义后的文本或属性展示 [[web-8](#web-8)]。

### web-16

当集成测试请求图标、静态文件、条件缓存以及不允许公开的文件时，测试应断言图标永久跳转 [[web-12](#web-12)]，静态服务的文件范围、响应头和 304 [[web-11](#web-11)]。
