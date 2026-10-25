# Agent with REA

利用 REA 的分析证据，把应用能力封装成 Agent 可发现、可调用、可验证的独立 CLI。

**产品目标：用户给出网站或应用文件，系统自动探索功能、用 REA 分析接口及调用链，生成覆盖该应用业务操作的 CLI，并通过真实调用验证。** 最终正常流程不要求用户手工提供 HAR、接口说明或适配器。网站、桌面应用和 Android 共用能力契约；底层接口包含 HTTP、原客户端请求模块、IPC 和本地方法。

当前已跑通一个真实网站和一个 Electron 应用的自动发现、多命令 CLI 与独立验收；任意应用的完整功能覆盖仍未实现。见 [产品目标、完整性定义与实现顺序](docs/product-goal.md)。

现在可以输入网址或 APK，让实际的 coding agent 根据 REA 证据生成适配器、编译 CLI、执行真实应用测试，并根据失败自动修复。命令名是 `app2cli`，仓库名是 Agent-with-rea。

**当前自动验收覆盖可恢复的内容或数值修改，以及 Android 多页面导航；不保证任意网站、任意 App 的所有功能都能生成。** 登录、设备权限、源码可见性和业务语义仍会影响结果；无法验证时会明确失败。

完整命令和环境准备见 [English README](README.md)。

已用此前没有适配器的在线应用 **Dillinger** 完成干净验收：输入网址后，agent 首轮生成的 CLI 通过 **8/8 真实检查**，再次复验也通过 **8/8**。故意谎报成功但不修改应用的测试副本，被独立观察器拦住；生成的包也通过仓库外独立安装和读取测试。通用测试可通过 `pnpm test` 运行。见 [验收摘要](docs/cases/generation-acceptance.json) 和 [未经手工修改的生成代码](examples/dillinger/README.md)。

Android 也已使用此前未适配的 **Editor 1.98** 完成 APK 输入验收：Agent 发起 3 次 REA 补充探查后生成候选，通过 **8/8 原生检查**；重启 App 后再次完整复验，同样通过 **8/8**。生成代码未经手改。见 [APK 复现步骤](docs/cases/android-generation.md)、[Android 验收记录](docs/cases/android-generation-acceptance.json) 和 [生成适配器](examples/editor/README.md)。故意不执行修改却返回成功的副本被独立观察器拦截；仓库外安装的 CLI 也完成了第二组文本的读取、修改、原生回读和恢复，运行依赖中没有 REA 或 Codex。本例操作当前文本缓冲区，不宣称保存了文件或修改了后端。

开发期间失败的运行和人工恢复步骤在摘要中单独披露，不算入成功验收。最终成功的干净运行没有沿用旧适配器，也没有在执行中修改框架或候选代码。本例验证的是浏览器本地持久化，不是服务端写入。

抖音 Android 也已完成未登录浏览/搜索实验：从官方页面的 APK 经 REA 分析生成基础适配器，再自动扩展为 10 个 CLI 命令，最终多页面场景通过 **23/23 原生检查**。包括中文搜索提交、实际结果读取和首页恢复。一次输入页资源 ID 复用导致的错误验收条件经过显式复核，原始失败和修订记录均保留；这不是全程无人干预或“覆盖抖音所有操作”的证明。见 [抖音实验与边界](docs/cases/douyin-android.md)、[验收摘要](docs/cases/douyin-android-acceptance.json) 和 [生成代码](examples/douyin-android/README.md)。

## 只输入网址或 Electron 应用文件

```bash
node bin/app2cli.mjs generate https://demo.linkding.link/
node bin/app2cli.mjs generate /path/to/Editor.app
```

无需提供 HAR、接口清单或适配器。系统创建独立会话，采集源码与请求，执行 REA 分析，由 Agent 探查并生成业务命令，再通过真实调用、独立回读和失败反馈完成验收。网址默认走此流程；省略输出目录时自动创建私有运行目录。

- **Linkding 官方演示站**：生成列表、搜索、读取、创建、修改、删除 6 个命令；生成验收、重复验证、仓库外安装均通过 **13 项检查**。
- **MarkText 0.19.1**：生成打开、读取、编辑、保存、重新打开、恢复 6 个命令；三轮验收均通过 **18 项检查**，同时核对真实编辑器和磁盘文件。
- 两组“返回成功但没有修改”的负例都被独立观察器拦截，清理完成。生成适配器未手改；开发中的框架修正、一次独立清理网站测试数据和 REA 的限制均保留记录。

当前样例限定在隔离测试命名空间内；CLI 运行仍需要原浏览器登录会话或 Electron 进程，但不需要 REA 或模型。见 [复现方法](docs/cases/application-generation.md)、[验收记录](docs/cases/application-generation-acceptance.json)、[网站生成代码](examples/linkding/README.md) 和 [桌面生成代码](examples/marktext/README.md)。

## API 优先

默认生成策略已改为 API 优先。旧的显式 HTTP 路线仍支持提供真实 HAR 和自有测试资源契约，由 REA 分析网络证据，Agent 生成直接 HTTP CLI，测试器另发 GET 验证修改和恢复。鉴权值只在运行环境中注入。未找到可验证 API 时明确停止；旧的浏览器函数 / Android UI 路线必须显式传 `--allow-ui-fallback`。

已在 Restful Booker 真实公共测试后端完成自动生成：最终运行首个候选通过 8/8 检查，实际执行 PATCH、独立 GET 并恢复原记录。此前公共后端重置导致的恢复失败单独保留，未计作通过。见 [API 验收记录](docs/cases/api-first-acceptance.json) 和 [未经手改的生成契约](examples/booker-api/README.md)。

另有只读的抖音 Web API 桥接样例：调用原客户端请求模块，复用浏览器登录态和签名链，并检查实际后端响应。它依赖浏览器，当前只覆盖账号确认与收藏夹列表读取。详见 [API 路线、复现和边界](docs/cases/api-first.md)。

## 工作流程

`网址 / APK → REA 分析 → Agent 生成适配器 → 独立 CLI → 真实调用和独立回读 → 失败反馈给 Agent 修复`

- **分析层**：保存真实 REA stdout 和来源哈希，区分原始证据与本项目生成的摘要。
- **适配包**：描述命令、输入 Schema、版本约束、执行入口和后置条件。
- **CLI 生成器**：核对证据与适配包，生成可单独安装的 npm 包。
- **通用运行时**：参数检查、会话范围、状态版本、跨进程锁、请求去重、私有审计和结果验证。
- **自动生成循环**：实际调用已登录的 Codex CLI；Agent 进程只读证据，运行器执行调用方允许的导航探查和候选代码测试。每轮保存输入、原始输出和真实失败，默认最多 4 轮。
- **独立测试器**：HTTP 另发 GET 并核对非目标字段、原始资源恢复；Web 刷新页面后直接读取 DOM，Android 重新抓取原生 UI 层级；观察过程不调用适配器的结果函数。恢复原始状态失败时停止继续修改。

## 自动生成

准备 Node.js 24.11+、依赖、Chrome 和已登录的 Codex CLI 后：

```bash
node bin/app2cli.mjs generate https://dillinger.io/ \
  --allow-ui-fallback --id dillinger --out .local/generate/dillinger \
  --goal "读取和替换当前 Markdown 文档，刷新后检查预览并恢复原文"
```

只传网址时会自动创建独立 Chrome 配置和本地 CDP 端口。已登录的网站可显式传 `--cdp` 和 `--target`，无需把 Cookie 或密码交给 agent。APK 输入方式：

```bash
node bin/app2cli.mjs generate /path/to/application.apk \
  --allow-ui-fallback --id my-app --serial emulator-5554 --install --out .local/generate/android
```

Android 需要已配置的 REA/JADX 和授权设备。`--install` 仅安装设备中不存在的包；现有安装包哈希不一致时会拒绝覆盖。未适配的 Editor APK 已完成真实自动生成验收；这仍不能推断为覆盖任意 APK、任意功能。

成功后，`result.json` 给出 CLI 路径、调用所需环境、适配器哈希和验证报告。先用 `--schema` 查看实际生成的命令，用 `--capabilities` 查看功能清单及具体已验收场景。无需再次消耗模型调用即可复验：

```bash
node bin/app2cli.mjs verify .local/generate/dillinger --out .local/verify/dillinger
```

生成器不读取内置适配器来匹配网站；新目标的语义映射来自当次 agent 输出。Web 测试使用每次随机生成且修复期间不可更改的文本，避免以现有页面内容替换预期来通过测试。完整选项和证据边界见 [自动生成说明](docs/usage.md)。

## 已实现的样例

| 样例 | 实际执行方式 | 验证等级 |
| --- | --- | --- |
| Knockout TodoMVC | 调用原页面 view model 的增删改函数 | 模型、DOM、localStorage 一致，并通过页面刷新确认 |
| Fossify Calculator 1.4.0 | 通过 ADB 操作原生控件，使用当前层级定位坐标 | 两次独立 UI 层级回读；不声称服务端确认或重启持久化 |
| Editor 1.98，APK 自动生成 | 原生文本输入、编辑模式切换和模式恢复 | 独立 UI 回读、原文恢复、重启 App 后完整复验 |
| 抖音 Android 32.2.6，APK 生成并扩展 | 原生中文输入、搜索提交、结果和页面导航 | 多页面独立回读；仅验证未登录范围，不宣称私有 API 或全功能覆盖 |

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
node bin/app2cli.mjs build examples/todomvc --evidence .local/evidence/web --out dist/todomvc
node dist/todomvc/cli.mjs --schema
node dist/todomvc/cli.mjs todos list
```

Android 需要已授权的 ADB 设备和完整 JDK。下载脚本会核对 APK / JADX 的 SHA-256，具体步骤见英文 README 的 Android 部分。当前样例无需 root，不使用 Frida。登录型应用由用户在原客户端完成登录，账号凭据不应进入适配包。

## 接入其他应用

优先使用 `generate` 自动循环。也可手动用 `inspect` 保存 REA 证据，再用 `scaffold` 生成草稿和候选信息，按 [适配器契约](docs/adapter-contract.md) 完成语义映射，再用 `build` 生成 `<应用>-cli`。新应用的控件、函数、协议、状态模型和业务校验由适配器表达。

生成器会把构建标记为 `runtimeVerified: false`。只有实际执行和回读测试才能提供运行验证；代码存在、静态分析通过或 CLI 返回零退出码都不能单独证明业务操作成功。

## 开源边界

仓库包含通用代码、样例配方、复现脚本和脱敏验收摘要。个人账号、浏览器配置、令牌、原始截图、原始 REA 输出和下载二进制保存在 `.local/`，不进入发布包。前一轮抖音账号实验留在本机原型中，本仓库不把它宣称为已迁移的通用适配器。

当前已有 [OpenCLI](https://github.com/jackwener/OpenCLI)、[CLI-Anything](https://github.com/HKUDS/CLI-Anything) 等相关项目。这里重点验证的是 **REA 证据、跨平台适配契约、独立 CLI 产物、实际执行与回读验证之间的连接**。

本项目代码使用 MIT 许可证；REA 和第三方样例保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 仓库结构

项目保持单个 npm 包：`src/generator` 负责发现、REA 分析和生成修复，`src/runtime` 负责 CLI 执行，`src/drivers` 连接真实应用，`src/verify` 独立回读验证。样例统一放在 `examples`，真实场景测试放在 `test/live`，公开案例报告放在 `docs/cases`。详见[架构说明](docs/architecture.md#repository-layout)和[样例索引](examples/README.md)。

生成的 CLI 按实际模块依赖打包，包含所需平台驱动及资源。旧样例通过少量 `lib` 兼容导出保持源码和摘要不变；新适配器使用稳定的 `#app2cli/*` 导入。
