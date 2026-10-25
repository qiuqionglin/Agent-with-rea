# Application discovery and multi-command generation

The application workflow accepts a website URL or a macOS Electron `.app` bundle. It captures and analyzes the target, asks the coding agent for bounded discovery probes and a multi-command adapter, builds a CLI, executes a lifecycle with independent observers, and feeds actual failures back into generation. No caller-supplied HAR, endpoint list, adapter, or resource-field contract is required.

This is a bounded implementation, not proof of complete coverage of arbitrary websites or Electron applications. The two accepted examples are the official Linkding demo and an existing MarkText 0.19.1 desktop installation. Neither example is selected by hostname, package name, or a bundled recipe in the generator.

## Run

With Node 24.11+, repository dependencies, REA 6.7.0, Chrome and an authenticated coding-agent CLI available:

```bash
node bin/app2cli.mjs generate https://demo.linkding.link/
node bin/app2cli.mjs generate /path/to/Editor.app
```

A plain URL now selects application discovery by default; `.app` input selects the Electron workflow. Omitted output paths produce a new private directory under `.local/generate/`. Existing `--capture` / `--api-case` HTTP generation and explicit `--allow-ui-fallback` workflows retain their prior routes. APK workflows remain separate; this change does not implement Android internal API recovery.

The recorded tests used explicit names/output directories and per-run authoring settings:

```bash
node bin/app2cli.mjs generate https://demo.linkding.link/ \
  --scenario application --id linkding --out .local/generate/linkding-application \
  --agent-model gpt-6.1-sol --agent-effort high --codex-ignore-config --max-rounds 24

node bin/app2cli.mjs generate /Applications/marktext.app \
  --scenario application --id marktext --out .local/generate/marktext-application \
  --agent-model gpt-6.1-sol --agent-effort high --codex-ignore-config --max-rounds 20
```

The actual target inputs were only the URL and application path. Output naming/model settings do not supply an API mapping. The development runs included stopped/resumed attempts and framework fixes, disclosed below. The desktop input is an already-installed real application, not a test application built by this repository.

`--prepare-only` retains discovery preparation without calling the authoring model. `--resume --out <existing-run>` continues a matching stopped/prepared run after checking retained evidence and the desktop artifact. A stopped cleanup failure can resume only after the declared independent cleanup witnesses now pass; it does not retry uncertain writes blindly. `--max-rounds` includes probes, unsuccessful candidates and successful candidates, not just tests. Completed runs are repeated through `verify`.

```bash
node scripts/run-generated.mjs .local/generate/linkding-application --schema
node scripts/run-generated.mjs .local/generate/marktext-application --capabilities
node bin/app2cli.mjs verify .local/generate/marktext-application --out .local/verify/marktext
```

The helper loads that completed run's private session bindings and checks the adapter digest. It does not log in, start a model, or start a new app session. The browser/Electron process from generation must remain available. Packaged CLIs can also be installed separately and called with the environment described by `result.json`. Ordinary calls need the original session/app, not REA or the authoring model.

## Discovery and provenance

- Web discovery launches or connects to a selected browser, retains same-origin source bytes, captures actual network exchanges with credential fields redacted, and runs REA source/network analysis. Agent-requested probes inspect forms, observed links, and runtime state. Public demo credentials explicitly offered by the target may be used in that dedicated profile; personal login remains a user action.
- Electron discovery identifies the ASAR from the supplied `.app`, inventories/extracts bounded source members, runs REA static analysis and fuse inspection, launches the app with a private profile, and observes its renderer. Source selection and unselected files remain explicit. The tested MarkText application honors its profile argument; this is not an assertion that every Electron application implements identical profile behavior.
- Agent probes and orchestrator summaries have their own producer labels. They are not relabeled as raw REA output. Prior probe results within the same run are consolidated in `discovery.json`; original outputs remain available. The complete raw model stdout, candidate and failed reports remain private.
- The generated adapter consumes `ctx.request = {command,input}`, `ctx.workspace` and `ctx.namespace`. The namespace is a runtime session binding; a concrete test UUID cannot be compiled into the final adapter. New test files are created only as explicitly labeled fixture inputs. Generated application commands use application methods, IPC or HTTP requests; they may not substitute direct filesystem/DOM writes or UI clicks.

The example CLIs are deliberately confined to their isolated test workspace/namespace. Their scopes should not be described as unrestricted access to personal files or all records of the shared demo account.

## Independent acceptance

`application-journey` plans exercise at least four distinct business commands, two mutations and explicit cleanup. Every step declares an observer. Web observers make fresh authenticated GETs and extract server HTML/JSON without importing adapter code; Electron observers inspect the actual renderer and read persisted files through a separate filesystem observer. Electron acceptance needs both renderer and file evidence.

Content mutations must produce a change. Navigation can be idempotent when its postcondition is already true; reports record whether a transition was actually observed. The runner additionally checks dry-run preservation, verified-request deduplication and stale-state rejection on a content mutation. Initial expectations become fixed once a candidate is actually built and tested. Early syntax/schema/evidence failures cannot freeze an untested scenario accidentally.

A deliberate no-op content mutation plus a lying `matches()` is used as a negative control. Both real examples were rejected by independent readback and then cleaned up. Each accepted package was installed outside the repository and reran its whole lifecycle with unusable analyzer/authoring paths and no installed REA dependency.

## Actual results and limits

| Target | Generated business commands | Initial accepted lifecycle | Repeat | Installed package |
| --- | --- | --- | --- | --- |
| Linkding official demo | `bookmarks.list`, `search`, `get`, `create`, `update`, `delete` | 13 checks | 13 checks | 13 checks |
| MarkText 0.19.1 | `document.open`, `read`, `edit`, `save`, `reopen`, `restore` | 18 checks | 18 checks | 18 checks |

Linkding commands call real backend form endpoints through the retained browser session. No UI clicks occur in generated command execution. This is browser-session HTTP, not a browser-independent token client. Account settings, archiving and dedicated tag management are not accepted features.

MarkText commands use observed editor methods and IPC, including native open/save behavior. Its actual editor and saved file were checked independently, another fixture document was preserved, and original text was restored. Create/delete documents, search, export, and the rest of the application are not accepted features. REA found 131 literal IPC channels and 58 exposed members in the selected source slice; those static observations do not imply 131 callable or tested commands.

The installed MarkText artifact reported eight ASAR companion integrity contradictions. REA's `record-and-continue` preserved those as untrusted observations; they were not erased or converted to a publisher-authenticity claim. Runtime pinning checks the observed ASAR bytes, not every native dependency. REA also excluded the selected renderer URL from its runtime inspector; that failed result is retained, and renderer execution evidence comes from the separate session driver. Static REA analysis succeeded.

Development interventions are part of the record: an evaluate-probe invocation bug, missing Electron command transport enum, incomplete probe-history reuse, premature freezing of an untested plan, and repeat-test treatment of idempotent navigation were corrected. One failed Linkding candidate created its owned bookmark but then rejected volatile pagination metadata; automatic cleanup also failed. The orchestrator removed that exact marked record using the already-discovered native delete form, independently confirmed absence, and retained the failed run before continuing. A subsequent model candidate repaired the adapter and passed. This is not claimed as an uninterrupted, intervention-free development run.

[Public acceptance projection](application-generation-acceptance.json) records digests, checks, negative controls, source limitations and development failures. [Linkding source](../../examples/linkding/README.md) and [MarkText source](../../examples/marktext/README.md) are unchanged copies of the accepted model candidates. Credentials, raw captures, profiles, original application source and private trajectories are not published.
