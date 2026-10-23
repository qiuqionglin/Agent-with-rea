# Agent with REA

**Turn application knowledge into verifiable CLIs for agents.**

`app2cli` uses [REA](https://github.com/morluto/rea) to inspect an application, helps an agent author a semantic adapter, and compiles the adapter into a separate CLI package. Each generated CLI exposes typed commands, JSON output, request deduplication, version checks, and execution evidence.

[中文说明](README.zh-CN.md) · [Adapter contract](docs/adapter-contract.md) · [Architecture and scope](docs/architecture.md) · [Acceptance evidence](docs/acceptance.json)

```text
Application → REA evidence → semantic adapter → per-app CLI → execute → verify
                              ↑
                     agent-written and reviewed
```

The architecture is open to more applications. **Automatic support for every website or app is a goal, not a current capability.** Analysis candidates are not automatically trusted executable commands. Draft adapters cannot be built until their mapping is completed.

## What works today

| Example | Execution | Verification | Generated command |
| --- | --- | --- | --- |
| Knockout TodoMVC | Original browser view-model functions | Model + DOM + localStorage + reload | `todomvc-cli todos create --title "Hello"` |
| Fossify Calculator 1.4.0 | Original Android UI controls via ADB | Two fresh native UI hierarchy observations | `fossify-calculator-cli calculate --a 12 --operator multiply --b 7` |

The recorded local run passed **13/13 real-app checks** and **10/10 kernel/compiler tests**. The framework and both generated tarballs also passed an isolated installation/readback check outside the repository, with no REA dependency in the generated runtime. See [package verification](docs/packaging-check.json).

Both examples have been exercised on real applications. The Android example reads `84` from the installed app; it does not return a locally calculated answer. Local arithmetic is only a postcondition used to check the app's output. Android UI readback does not claim backend confirmation or persistence across process restarts.

## Install from this repository

Requirements: Node.js **24.11+**, pnpm, Chrome for the Web example. Android additionally needs an authorized ADB device/emulator and a full JDK 17+ for the pinned JADX analysis provider.

```bash
git clone https://github.com/qiuqionglin/Agent-with-rea.git
cd Agent-with-rea
pnpm install --frozen-lockfile --ignore-scripts
node bin/app2cli.mjs --help
node bin/app2cli.mjs list
```

REA is pinned to `6.7.0`. Set `REA_CLI_PATH` to its `scripts/rea.mjs` if it is installed elsewhere. No global agent configuration is modified. Downloaded applications, browser profiles, raw evidence and execution journals belong under ignored `.local/` directories.

## Web: inspect, build, run

Start the unmodified, commit-pinned TodoMVC example in terminal 1:

```bash
pnpm demo:web
```

This serves the original application at `http://127.0.0.1:4317` and starts a dedicated Chrome profile with CDP at port `9377`. `CHROME_PATH` can select an installed Chrome executable; `HEADED=1` shows the window.

In terminal 2:

```bash
export APP2CLI_CDP=http://127.0.0.1:9377
export APP2CLI_HOME="$PWD/.local/state"

node bin/app2cli.mjs inspect web "$APP2CLI_CDP" --out .local/evidence/web
node bin/app2cli.mjs build adapters/todomvc \
  --evidence .local/evidence/web --out dist/todomvc

node dist/todomvc/cli.mjs --schema
node dist/todomvc/cli.mjs todos create --title "Hello from an agent" --request-id task-001
node dist/todomvc/cli.mjs todos list
```

`inspect` requires `--target <CDP target ID>` when more than one page is present. Choose the exact page rather than an arbitrary tab. Build outputs must be new directories. Each output is a normal npm package with its own executable:

```bash
cd dist/todomvc
npm install --ignore-scripts
npm link
todomvc-cli todos list
```

## Android: inspect the APK, then use the native app

1. Install a full JDK and Android platform-tools. Start a test emulator or authorize a test device. `adb devices` must show the selected device as `device`.
2. Download the pinned APK and JADX provider. The helper verifies SHA-256 and does not install anything globally:

```bash
node scripts/fetch-android.mjs
export REA_JADX_MCP_JAR="$PWD/.local/android/jadx.jar"
# JAVA_HOME must point to your full JDK, including jdk.compiler.
export APP2CLI_ANDROID_SERIAL=emulator-5554  # use your actual adb devices serial
export APP2CLI_HOME="$PWD/.local/state"
# Set REA_ADB_PATH to an absolute adb executable if it is not on PATH.

adb -s "$APP2CLI_ANDROID_SERIAL" install .local/android/calculator.apk
node bin/app2cli.mjs inspect android .local/android/calculator.apk \
  --class org.fossify.math.activities.MainActivity --method onCreate \
  --out .local/evidence/android
node bin/app2cli.mjs build adapters/fossify-calculator \
  --evidence .local/evidence/android --out dist/fossify-calculator

node dist/fossify-calculator/cli.mjs display
node dist/fossify-calculator/cli.mjs calculate \
  --a 12 --operator multiply --b 7 --request-id calc-001
```

The driver checks the installed APK hash, launches an exported activity, finds controls by resource ID, and derives coordinates from the current hierarchy. No root, Frida injection, or fixed screen coordinates are needed for this sample. Four arithmetic operators and bounded nonnegative integer operands are supported; it is not the entire Calculator feature set.

## Add another application

```bash
node bin/app2cli.mjs scaffold --id my-app \
  --evidence .local/evidence/web --out adapters/my-app
```

The draft contains a candidate summary, a manifest and a deliberately non-executable adapter. An agent must implement the [adapter contract](docs/adapter-contract.md), map actual operations, add concrete version/evidence claims, and define independently checkable postconditions. Remove `config.draft` only after that work. Then build against the original REA evidence and run a bounded acceptance scenario.

Generated packages contain the authored adapter and small shared runtime. They do not contain raw capture data, user profiles, cookies, device serials, APKs, or a background REA server. REA is needed for analysis/build evidence, not for executing a compiled capability.

## Agent command contract

- Standard output is JSON. Progress goes to standard error. Failures set a nonzero exit status.
- `--schema` / `--help` describe capabilities without connecting to the app.
- Named flags are typed from JSON Schema; `--input '{...}'` supports structured input.
- Reuse `--request-id` for the exact same mutation retry. A dispatched operation without a verified outcome is not automatically repeated.
- Supply `--expected-revision` from an earlier read to reject stale state. `--dry-run` reads and plans without dispatching.
- A successful mutation includes its actual verification level and a private audit path.

Example result, abbreviated:

```json
{"ok":true,"app":"fossify-calculator","command":"calculate","data":{"result":"84","formula":"12×7"},"verification":{"level":"native-ui-readback","stages":["dispatched","readback_verified","fresh_readback_verified"]}}
```

See [llms.txt](llms.txt) for the compact agent guide.

## Tests and limits

```bash
pnpm test                # fixture-based kernel and compiler tests
pnpm test:live           # real Web + Android, after both analyses and sessions are ready
pnpm pack --pack-destination .local/packages
pnpm check:release --tarball .local/packages/agent-with-rea-0.1.0.tgz
```

CI runs unit and package checks. It does not pretend to run a signed-in browser or an Android device. The published [acceptance summary](docs/acceptance.json) records the separate local live run.

Current limits include authored semantic mappings, one browser and one Android example, local process locks, no automatic login renewal, no Android internal-method/Frida driver, and no iOS/desktop runtime driver. A source or APK change fails closed and requires reanalysis. Evidence substring checks validate recipe anchors, not a formal proof that the adapter correctly implements a business operation; real readback tests remain necessary.

## Related projects and license

[OpenCLI](https://github.com/jackwener/OpenCLI) provides browser primitives and site adapters. [CLI-Anything](https://github.com/HKUDS/CLI-Anything) generates application harnesses. This project explores a REA evidence-to-adapter workflow shared across Web and Android, with explicit execution verification. It does not claim that the broader application-to-CLI idea is new.

Project-authored code is MIT licensed. REA, runtime dependencies and example applications retain their own licenses. No third-party application binary or decompiled source is shipped. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
