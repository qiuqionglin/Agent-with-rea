# Adapter contract v1

An adapter directory contains `adapter.json` and `adapter.mjs`. Use `app2cli scaffold` after a successful analysis to create a draft. The manifest is validated against [adapter.schema.json](../schemas/adapter.schema.json).

## Manifest

- `id`: portable lowercase CLI/package identifier.
- `platform`: `web` or `android` in v1.
- `config`: application pins and driver settings; do not store account credentials or personal device settings here.
- `commands`: description, `readOnly` and an object JSON Schema for each command.
- `analysis`: authored recipe description and exact claims to find in raw REA evidence.
- `verification`: the strongest level the adapter actually implements. Current example levels are `reload-persisted` and `native-ui-readback`. `server-confirmed` is reserved for implementations that inspect real backend responses and perform independent backend reads.

Command IDs can contain dots. `todos.create` is exposed as either `todos.create` or `todos create`. Simple inputs become named flags; use `--input` for nested JSON. Every compiled adapter carries a frozen digest checked before execution.

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

`scopeKey` identifies the observed principal or local session. Do not use an account supplied by the caller without checking it against the application. A browser module, cookie or device address being present does not prove authentication. The shipped examples use isolated browser target/device scopes because they require no account.

`refresh` has different meanings for different transports. A page reload can verify browser persistence. A new Android UI hierarchy confirms displayed state but says nothing about durable storage or backend state. Describe the distinction in the manifest and acceptance report.

## Authoring loop for an agent

1. Inspect the selected page/APK with REA and retain original evidence.
2. Read the relevant source, manifest, method and runtime findings. Record uncertainty.
3. Select a small meaningful capability and define its input and output semantics.
4. Map to existing native functions, exported interfaces, or native controls. Declare the chosen transport.
5. Pin the source/APK and verify the current session before each invocation.
6. Write readback conditions that distinguish an acknowledgement from an actual effect.
7. Build against the original analysis; the generated package remains runtime-unverified.
8. Run a bounded real-app scenario, including invalid inputs, stale state, retries and restoration where applicable.
9. Publish the authored adapter and sanitized test summary. Keep personal captures, profiles and credentials local.

## Error codes

`INVALID_INPUT`, `UNKNOWN_COMMAND`, `SESSION_REQUIRED`, `SESSION_BUSY`, `SESSION_CHANGED`, `VERSION_DRIFT`, `STALE_STATE`, `IDEMPOTENCY_CONFLICT`, `OUTCOME_UNCERTAIN`, `VERIFICATION_FAILED`, `CONFIRMATION_FAILED`, `EVIDENCE_MISMATCH`, `MAPPING_REQUIRED` and `ADAPTER_CHANGED` are machine-readable recovery signals.

Exit status 2 denotes invalid input/contract; 3 environment/session problems; 4 state or version conflict; 5 failed verification; 6 uncertain dispatch. Unexpected internal errors use 1. A caller must inspect the error, not retry all nonzero exits indiscriminately.
