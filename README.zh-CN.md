# Agent with REA

利用 REA 的分析证据，把应用能力封装成 Agent 可发现、可调用、可验证的独立 CLI。

**当前是可扩展框架和两个真实样例，不是已经自动支持所有网站与 App。** 目标应用的语义映射仍由 Agent 编写和检验；未完成的草稿不能构建。命令名是 `app2cli`，仓库名是 Agent-with-rea。

完整命令和环境准备见 [English README](README.md)。

## 工作流程

`目标应用 → REA 分析 → 候选能力 → Agent 编写适配包 → 生成独立 CLI → 调用原应用 → 验证结果`

- **分析层**：保存真实 REA stdout 和来源哈希，区分原始证据与本项目生成的摘要。
- **适配包**：描述命令、输入 Schema、版本约束、执行入口和后置条件。
- **CLI 生成器**：核对证据与适配包，生成可单独安装的 npm 包。
- **通用运行时**：参数检查、会话范围、状态版本、跨进程锁、请求去重、私有审计和结果验证。

## 已实现的样例

| 样例 | 实际执行方式 | 验证等级 |
| --- | --- | --- |
| Knockout TodoMVC | 调用原页面 view model 的增删改函数 | 模型、DOM、localStorage 一致，并通过页面刷新确认 |
| Fossify Calculator 1.4.0 | 通过 ADB 操作原生控件，使用当前层级定位坐标 | 两次独立 UI 层级回读；不声称服务端确认或重启持久化 |

```bash
todomvc-cli todos create --title "Agent 创建的任务" --request-id task-001
fossify-calculator-cli calculate --a 12 --operator multiply --b 7 --request-id calc-001
```

Android 返回值来自实际安装的 Calculator。中间层只计算预期结果用于核验，不会把本地算出的数字当成 App 的返回结果。示例只覆盖有限算术操作，未封装整个 App。

## 在源码中运行

```bash
pnpm install --frozen-lockfile --ignore-scripts
node bin/app2cli.mjs --help
node bin/app2cli.mjs list
pnpm demo:web
```

另一个终端完成 Web 分析、构建和调用：

```bash
export APP2CLI_CDP=http://127.0.0.1:9377
export APP2CLI_HOME="$PWD/.local/state"
node bin/app2cli.mjs inspect web "$APP2CLI_CDP" --out .local/evidence/web
node bin/app2cli.mjs build adapters/todomvc --evidence .local/evidence/web --out dist/todomvc
node dist/todomvc/cli.mjs --schema
node dist/todomvc/cli.mjs todos list
```

Android 需要已授权的 ADB 设备和完整 JDK。下载脚本会核对 APK / JADX 的 SHA-256，具体步骤见英文 README 的 Android 部分。当前样例无需 root，不使用 Frida。登录型应用由用户在原客户端完成登录，账号凭据不应进入适配包。

## 接入其他应用

先用 `inspect` 保存 REA 证据，再用 `scaffold` 生成草稿和候选信息。Agent 按 [适配器契约](docs/adapter-contract.md) 完成语义映射，再用 `build` 生成 `<应用>-cli`。新应用的控件、函数、协议、状态模型和业务校验仍需要单独确定。

生成器会把构建标记为 `runtimeVerified: false`。只有实际执行和回读测试才能提供运行验证；代码存在、静态分析通过或 CLI 返回零退出码都不能单独证明业务操作成功。

## 开源边界

仓库包含通用代码、样例配方、复现脚本和脱敏验收摘要。个人账号、浏览器配置、令牌、原始截图、原始 REA 输出和下载二进制保存在 `.local/`，不进入发布包。前一轮抖音账号实验留在本机原型中，本仓库不把它宣称为已迁移的通用适配器。

当前已有 [OpenCLI](https://github.com/jackwener/OpenCLI)、[CLI-Anything](https://github.com/HKUDS/CLI-Anything) 等相关项目。这里重点验证的是 **REA 证据、跨平台适配契约、独立 CLI 产物、实际执行与回读验证之间的连接**。

本项目代码使用 MIT 许可证；REA 和第三方样例保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
