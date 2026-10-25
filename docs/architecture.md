# Architecture and evidence boundaries

Agent with REA separates application analysis from application execution.

```mermaid
flowchart LR
  Target[Web page or Android APK] --> REA[REA analysis]
  REA --> Raw[Private raw evidence]
  Raw --> Draft[Candidate projection and draft]
  Draft --> Agent[Agent-authored semantic mapping]
  Agent --> Build[Evidence-checked compiler]
  Raw --> Build
  Build --> CLI[Independent application CLI]
  CLI --> Runtime[Shared runtime]
  Runtime --> HTTP[Direct HTTP API]
  Runtime --> Bridge[Original client API bridge]
  Runtime --> Web[Explicit browser-function fallback]
  Runtime --> Android[Android native UI]
  HTTP --> Server[Independent server GET]
  Bridge --> Network[Observed backend response]
  Server --> Audit
  Network --> Audit
  Web --> Readback[Application readback]
  Android --> Readback
  Readback --> Audit[Private audit and request journal]
  CLI --> Test[Independent native observer]
  Test -->|failure details| Agent
  Test -->|verified effect and restoration| Accepted[Generation report]
```

## What each artifact proves

| Artifact | Producer | Meaning |
| --- | --- | --- |
| REA `*.json` stdout | REA 6.7.0 | Observations returned by the actual analysis provider, including its limitations |
| `evidence.json` | This framework | File/hash index of those outputs |
| `candidates.json` | This framework | Analysis projections for an agent; not runnable capabilities |
| `adapter.json` / `adapter.mjs` | Adapter author or coding agent | Claimed business mapping, target version and postconditions |
| `provenance.json` | Compiler | Claims were found in the selected analysis; `runtimeVerified` remains false |
| Execution audit | Runtime | Before / dispatch / after / fresh readback and errors |
| Acceptance summary | Test runner | Which scenarios actually passed in that run |
| `agent.stdout` / `agent.stderr` | Codex CLI | Native generation trace, retained privately |
| `generation.json` | Orchestrator | Attempt history and links to actual test failures; not a model-native trajectory |

The compiler checks raw-output digests and recipe anchors. It is not a semantic proof engine or a defense against a deliberately malicious local author. Adapter modules execute trusted local JavaScript. A REA finding can be incomplete; no generated wrapper can recover permissions, unavailable backend state, or unknown behavior merely by having a CLI name.

## Reusable kernel

`lib/runtime.mjs` has no website IDs, Android package IDs, business commands or hard-coded account data. It validates schema, identifies the execution surface, locks it across processes, checks the app version, reads state, computes a revision, reserves mutation request IDs, dispatches, verifies and writes a journal.

The lock is per execution surface rather than per adapter. Two adapters operating one Android device therefore share a lock. Journals are scoped by application and observed principal/session. Audit paths include the scope hash so reused request IDs in different accounts do not overwrite each other.

An outcome reserved before dispatch but not verified stays uncertain. It cannot be silently retried, even after a process restart. Verified replays return the historical result; use a separate read when current state is needed. Local journals and locks do not provide distributed exactly-once semantics. A crashed owner may leave a lock; inspect its `owner.json` before removing a confirmed stale directory.

## Drivers and current scope

| Channel | Status | Practical meaning |
| --- | --- | --- |
| Browser native functions | Implemented and tested | Invoke existing application functions through a selected CDP page |
| Android UI | Implemented and tested | Version-pinned APK, exported launcher, native resource-ID actions and UI readback |
| Direct HTTP API | Implemented | Observed HAR + owned-resource contract; auth environment binding, schema checks, direct requests, independent GET |
| Signed-in Web backend | Read-only driver and Douyin example implemented | Original request/signing chain; pinned source bytes, account guard, actual network response proof; still needs browser |
| Android internal methods / Frida | Planned | Requires a separate runtime driver, method mapping and real acceptance evidence |
| Desktop, iOS | Planned | Interface permits plugins; these transports are not implemented |

REA supports more analysis targets than this repository currently supports for execution. Analysis coverage and operational coverage must be reported separately.

## Generation loop

`generate` accepts a URL or APK without selecting a bundled adapter. REA analysis and independent DOM/UI observations provide the input. Codex returns a structured candidate or requests a bounded read-only probe. The framework validates, compiles and tests it in separate processes. Failures are fed back into a new attempt, with the original objective frozen. A failed restoration halts mutation attempts. See [automatic generation](generation.md) for the current reversible-value scope and evidence limitations.

## Operational findings

- TodoMVC's storage update is delayed. The runtime waits for model, DOM and storage to agree, then reloads.
- Android's launcher can recreate Calculator state. The driver checks the resumed activity and reuses an already foreground application, preserving read/replay behavior.
- Android calculation confirmation uses a second fresh UI hierarchy, not app restart. It reports `native-ui-readback` accordingly.
- This machine's REA native helper needed a macOS SDK matching its Swift compiler. An optional per-process `SDKROOT` solved it locally; no SDK path is hard-coded in the project.

## Relationship to existing projects

[OpenCLI](https://github.com/jackwener/OpenCLI) exposes browser primitives and site adapters, including an adapter-author workflow. [CLI-Anything](https://github.com/HKUDS/CLI-Anything) generates application CLI harnesses and describes source availability as a quality constraint. This project combines [REA](https://github.com/morluto/rea)'s analysis evidence with a small cross-platform adapter contract, independent CLI packaging and explicit result verification. These are design choices, not a claim that application CLIs are a new category.
