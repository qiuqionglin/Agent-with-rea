# Adapter contract v1

An adapter directory contains `adapter.json` and `adapter.mjs`. Use `app2cli scaffold` after a successful analysis to create a draft. The manifest is validated against [adapter.schema.json](../schemas/adapter.schema.json).

## Manifest

- `id`: portable lowercase CLI/package identifier.
- `platform`: `web`, `android`, `api`, or `electron` in v1. `api` requires `transport: "http"`.
- `config`: application pins and driver settings; do not store account credentials or personal device settings here.
- `commands`: description, `readOnly` and an object JSON Schema for each command.
- Optional `capabilities`: feature descriptions, declared command IDs and explicit implementation/login/user-action/unsupported status. Authors cannot label a capability verified; a separate digest-bound `acceptance.json` records the concrete tests that actually passed.
- `analysis`: authored recipe description and exact claims to find in raw REA evidence.
- `verification`: the strongest level the adapter actually implements. Current example levels are `reload-persisted` and `native-ui-readback`. `server-confirmed` is used by the direct HTTP driver with fresh server reads and the reviewed browser API bridge with real response observation. Generation acceptance separately requires independent GET for HTTP writes.

Command IDs can contain dots. `todos.create` is exposed as either `todos.create` or `todos create`. Simple inputs become named flags; use `--input` for nested JSON. Every compiled adapter carries a frozen digest checked before execution.

Each `analysis.claims` entry must be `{ "operation": "analyze_javascript_application", "contains": "a literal string present in that REA output", "sha256": "optional 64-character source digest present in that output" }`. `operation` is required and must exactly match an evidence-index record (underscore spelling, not the CLI command's hyphen spelling). `contains` and `sha256` are optional literal anchors. Graph nodes such as `{kind,label,properties}` are findings to interpret, not the compiler's claim format. Claims are anchor checks, not complete semantic proofs.

## JavaScript module

Export a default object with these methods:

| Method | Responsibility |
| --- | --- |
| `targetKey(env, config)` | Stable execution-surface key; adapters sharing a device/page must return the same key |
| `connect(env, config)` | Connect to the explicitly selected client; reuse an existing session where possible |
| `check(ctx, config)` | Enforce application/version/session pins; throw on drift |
| `read(ctx)` | Return `{scopeKey, data, proof}` from the actual app |
| `plan(command, input, before)` | Enforce business preconditions and produce serializable postconditions |
| `dispatch(ctx, command, input, plan)` | Invoke the mapped operation exactly once |
| `matches(plan, snapshot)` | Compare actual state with all required postconditions |
| `refresh(ctx)` | Prepare an independent confirmation appropriate to the declared verification level |
| `result(command, input, snapshot)` | Project actual observed application data into the command result |
| `close(ctx)` | Release this connection without closing unrelated user sessions |

Read commands call `check`, `read` and `result`. Mutation commands add plan, journal reservation, dispatch, bounded polling, refresh and confirmation. A successful dispatcher alone is insufficient. Preserve unrelated data in `matches`; do not only check that the new field exists.

For browser version checks, use source hashes and the actual native interface. Lazy-loaded bundles may remove their `<script>` elements after execution, so absence from `document.scripts` is not sufficient evidence of a changed deployment. Test checks after a normal reload, including the app's hydration path.
Webpack factory `Function.toString()` is also not a stable source-version fingerprint: duplicate module registrations and load order can select different wrappers in the same pinned deployment. Pin source bytes and verify the required callable methods and state shape rather than requiring a particular factory serialization.

`scopeKey` identifies the observed principal or local session. Do not use an account supplied by the caller without checking it against the application. A browser module, cookie or device address being present does not prove authentication. The shipped examples use isolated browser target/device scopes because they require no account.

`refresh` has different meanings for different transports. A page reload can verify browser persistence. A new Android UI hierarchy confirms displayed state but says nothing about durable storage or backend state. Describe the distinction in the manifest and acceptance report.

Android controls may change resource IDs when their mode changes. Read a new hierarchy after a transition instead of reusing the old ID. Keep initialization paths when repairing a candidate, including any precisely identified optional onboarding dialog. Do not send `KEYCODE_BACK` just to hide a presumed keyboard: input-method flags can indicate a shown input method even when a hardware keyboard is in use, and BACK can navigate away or open an unsaved-changes dialog. Keyboard visibility is not a content postcondition. The SDK exposes class, focus and password attributes as well as text, bounds and identifiers.

## Authoring loop for an agent

1. Inspect the selected page/APK with REA and retain original evidence.
2. Read the relevant source, manifest, method and runtime findings. Record uncertainty.
3. Select a small meaningful capability and define its input and output semantics.
4. Prefer observed HTTP endpoints or original client request exports. Declare `transport` on the adapter and commands; API generation requires REA-inspected network evidence. UI/native-function generation needs explicit caller fallback and a `fallbackReason`.
5. Pin the source/APK and verify the current session before each invocation.
6. Write readback conditions that distinguish an acknowledgement from an actual effect.
7. Build against the original analysis; the generated package remains runtime-unverified.
8. Run a bounded real-app scenario, including invalid inputs, stale state, retries and restoration where applicable.
9. Publish the authored adapter and sanitized test summary. Keep personal captures, profiles and credentials local.

## Error codes

`INVALID_INPUT`, `UNKNOWN_COMMAND`, `SESSION_REQUIRED`, `SESSION_BUSY`, `SESSION_CHANGED`, `VERSION_DRIFT`, `STALE_STATE`, `IDEMPOTENCY_CONFLICT`, `OUTCOME_UNCERTAIN`, `VERIFICATION_FAILED`, `CONFIRMATION_FAILED`, `EVIDENCE_MISMATCH`, `MAPPING_REQUIRED` and `ADAPTER_CHANGED` are machine-readable recovery signals.

Exit status 2 denotes invalid input/contract; 3 environment/session problems; 4 state or version conflict; 5 failed verification; 6 uncertain dispatch. Unexpected internal errors use 1. A caller must inspect the error, not retry all nonzero exits indiscriminately.

HTTP helpers are exported by `#app2cli/http`: `connectHttp`, `httpTargetKey`, `httpUrl`, `requestHttp`. Auth is an environment-bound header; origin-relative operation paths can use `{parameter}` values from separately declared resource environment variables. Callers must preserve auth/session scope and unrelated resource fields. See [API-first](cases/api-first.md) for the supported case and failure contract.

Application adapters receive `ctx.request = {command,input}` before checks/reads. `application-session.mjs` provides owned-session connections, browser requests, original app method invocation and workspace path guards. Electron uses `electron-api` and `native-file-readback`; its actual renderer and file witnesses are independent acceptance evidence. The generated namespace is a runtime binding, not a compiled test identifier. See [multi-command application generation](cases/application-generation.md).

## SDK imports and packaging

Use `#app2cli/sdk` for `AppError`, hashing and JSON helpers. Platform helpers are available from `#app2cli/web`, `#app2cli/browser-api`, `#app2cli/application`, `#app2cli/http`, `#app2cli/http-resource`, `#app2cli/android` and `#app2cli/android-ui`. These are package-local mappings that the compiler preserves in generated packages. Older `../../lib/*.mjs` imports remain compatible.

Keep the adapter in a single module. Use literal imports of these helpers, Node built-ins or the framework's declared dependencies. Computed adapter imports, undeclared dependencies and generator/verifier imports cannot form a self-contained runtime and are rejected. The compiler reads import syntax without executing the adapter and preserves its original source bytes.
