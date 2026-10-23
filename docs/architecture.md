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
  Runtime --> Web[Native browser functions]
  Runtime --> Android[Android native UI]
  Web --> Readback[Application readback]
  Android --> Readback
  Readback --> Audit[Private audit and request journal]
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
| Signed-in Web backend | Proven in an earlier local Douyin experiment, not packaged here | Browser retains authentication and the original request chain; server responses need dedicated verification |
| Android internal methods / Frida | Planned | Requires a separate runtime driver, method mapping and real acceptance evidence |
| Official HTTP API, desktop, iOS | Planned | Interface permits plugins; these transports are not implemented |

REA supports more analysis targets than this repository currently supports for execution. Analysis coverage and operational coverage must be reported separately.

## Operational findings

- TodoMVC's storage update is delayed. The runtime waits for model, DOM and storage to agree, then reloads.
- Android's launcher can recreate Calculator state. The driver checks the resumed activity and reuses an already foreground application, preserving read/replay behavior.
- Android calculation confirmation uses a second fresh UI hierarchy, not app restart. It reports `native-ui-readback` accordingly.
- This machine's REA native helper needed a macOS SDK matching its Swift compiler. An optional per-process `SDKROOT` solved it locally; no SDK path is hard-coded in the project.

## Relationship to existing projects

[OpenCLI](https://github.com/jackwener/OpenCLI) exposes browser primitives and site adapters, including an adapter-author workflow. [CLI-Anything](https://github.com/HKUDS/CLI-Anything) generates application CLI harnesses and describes source availability as a quality constraint. This project combines [REA](https://github.com/morluto/rea)'s analysis evidence with a small cross-platform adapter contract, independent CLI packaging and explicit result verification. These are design choices, not a claim that application CLIs are a new category.
