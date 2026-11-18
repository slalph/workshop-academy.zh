<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# request-contract: 业务入口的 HTTP 输入

## 意图

约定业务入口怎样解释对象请求体、资源编号和只读请求，使调用方能预知有效输入及其含义。

## 外部行为

### request-contract-1

当业务入口读取 JSON 对象请求体时，解析结果应按以下输入边界确定：

| 输入 | 解析结果 |
| --- | --- |
| 声明或实际长度超过 65536 字节 | 超长 |
| 空请求体或仅含空白 | 空对象 |
| 非空，按 UTF-8 解码后不是合法 JSON 对象（含数组、标量和 `null`） | 格式无效 |
| 合法 JSON 对象且未超长 | 提交的对象 |

### request-contract-2

当业务入口从资源路径取编号时，应只把无前导零的十进制正安全整数识别为有效编号。

### request-contract-3

当客户端对支持 `GET` 的资源发送对应的 `HEAD` 请求时，读取应使用相同的状态和表示头并省略响应体。

## 验证

### request-contract-4

当客户端通过真实对象接口提交输入矩阵时，集成测试应比较空白与空对象的业务结果、合法对象抵达业务操作的结果，并区分无效 JSON、非对象和超出 65536 字节的拒绝结果 [[request-contract-1](#request-contract-1)]。

### request-contract-5

当集成测试通过编号访问封面资源时，测试应核对有效编号与无效编号（含零、前导零和超出安全整数的数字）的识别结果 [[request-contract-2](#request-contract-2)]，并对同一资源比较 GET 和 HEAD 的状态、表示头与响应体 [[request-contract-3](#request-contract-3)]。
