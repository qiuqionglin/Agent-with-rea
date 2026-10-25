# Douyin Android: APK-to-CLI experiment

This target is the APK linked by the [official Douyin download page](https://www.douyin.com/downloadpage/app) during the experiment. It is version **32.2.6**, package `com.ss.android.ugc.aweme.mobile`. This does not claim it is the newest mobile-store release.

```text
APK URL:
https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/android-32.2.6/douyin.apk

SHA-256:
46a3ebd3cf4b9a5020ebcea3aee02facaa80a7baae492b2c12090e5e0999baf0
```

The user selected **logged-out browsing and search**. Account-dependent operations are outside this acceptance. A generic native tap is not evidence that every everyday Douyin feature is supported. The adapter uses the original app's native controls; it does not recover a general private HTTP API or bypass request signing, login or server checks.

## Environment and analysis

- Android 13 on an arm64 BlueStacks test device, authorized ADB, shell UID 2000, no root.
- REA `6.7.0`, JADX headless MCP `0.7.1`, JDK 21.
- Actual authoring agent: `gpt-6.1-sol`, reasoning `high`, selected per invocation without changing global configuration.
- Optional native backend: Python with `uiautomator2==3.7.1`. It provides Unicode text input and fresh hierarchy dumps for continuously animating video screens. The system input method was not replaced.

The initial local package inspection exceeded REA's 120-second deadline. A local retry with a 4 GiB heap was stopped under memory pressure; it is retained as a failed preparation attempt. The same APK and JADX bytes were transferred to the user's existing server and hash-checked. Unmodified remote REA stdout was copied back. A 7 GiB heap completed package inspection in about two minutes. Final package evidence reports 270,834 classes and 29,876 resources. These counts are static inventory, not functional coverage.

The agent requested `SearchResultActivity` member inventory and the decompiled `onBackPressed` method. These are retained as distinct REA outputs. The latter shows delegated back handling; it does not prove runtime navigation. Native observations and actual CLI tests establish that separately.

## What was generalized

- Multi-screen `android-journey` plans with independent positive/negative native predicates, separate-process CLI readback, dry-run checks, deduplication and declared landing-screen cleanup.
- Exact compound selectors, parent relationships and explicit fresh-bounds touch for custom controls that do not export a clickable flag.
- Caller-owned exploration allowlists. The agent cannot grant itself additional navigation or text actions.
- APK-hash-checked reuse of REA evidence and explicit extension of a previously passed generated adapter.
- `--capabilities`, separating authored feature declarations from actual accepted scenarios.

Cleanup establishes the declared landing screen only. It does not restore the exact feed item, playback position, search suggestions/history or backend state. Native UI readback is not an independent server/API confirmation.

## Reproduce

Download the APK separately and verify its hash. Complete any first-use agreement yourself. Supply an already authorized device and a dedicated Python environment:

```bash
python3 -m venv .local/android-python
.local/android-python/bin/python -m pip install uiautomator2==3.7.1
export APP2CLI_UIAUTOMATOR_PYTHON="$PWD/.local/android-python/bin/python"
export APP2CLI_ANDROID_SERIAL=your-authorized-device
export REA_ADB_PATH=/path/to/adb
export JAVA_HOME=/path/to/jdk
export REA_JADX_MCP_JAR=/path/to/jadx.jar
export REA_JADX_HEAP_MIB=7168
export REA_JADX_OPERATION_TIMEOUT_MS=600000
export APP2CLI_REA_TIMEOUT_MS=630000
```

Choose memory limits appropriate to the host. The experiment used remote REA analysis and local native execution; remote execution is an environment transport, not a requirement of the generated CLI. Do not put server credentials, cookies or account tokens in adapter configuration.

Use `app2cli generate <apk> --allow-ui-fallback --scenario android-journey` and a reviewed navigation-probe allowlist. See [generation](../usage.md) for `--analysis-evidence`, `--seed` and `--require-step`. A new first-time run still needs to discover its own controls; the generator does not choose this example by package name.

APK bytes, decompiled methods, raw model logs, native dumps, account state and test runtime directories are excluded from the repository. Only generated adapter source and sanitized acceptance metadata are intended for publication.


## Generated result and interventions

The first generated navigation adapter passed **19/19 native checks** after an
agent-authored repair to bounded search-back navigation. Its earlier runner was
interrupted after a failed return-home operation. The parent independently
confirmed that cleanup had reached home and resumed the retained failed run;
this recovery is not counted as an uninterrupted automatic success.

The search extension then passed **23/23 native checks** with ten declared
commands. Its first submission probe was refused because the app's search label
exports `clickable=false`; the generic explicit fresh-bounds touch primitive and
a caller allowlist entry were added. A subsequent candidate used an invalid
negative witness: the `lfp` RecyclerView ID also occurs on the input page. The
independent observer rejected it and confirmed cleanup. The model proposed
replacing that exclusion with the actual results `综合` tab, which the immutable
objective guard correctly refused as an unreviewed test change.

The parent explicitly reviewed that one change against the native evidence,
retained the original plan, and pinned the revised plan using `--reviewed-plan`.
Every other step, input, query, positive witness, readback and cleanup condition
remained identical. An in-progress authoring round was stopped before resuming
with that reviewed oracle; it was not a provider-authentication incident. The
final model-authored candidate also retained `scrollable` in its native state
projection, so result predicates could be evaluated correctly. Its source was
not manually edited. Framework source hashes were unchanged during the final
reviewed run.

The final adapter digest is:

```text
5619a0e81ca95e8f70b3ecb87b93c89ab66631ae63df0e4133714976f9aea1a5
```

See the [unchanged generated example](../../examples/douyin-android/README.md).
The framework's 40 unit/protocol tests are separate from the real-device checks.


## Independent installation and negative control

The generated tarball was installed outside the checkout, with no REA or Codex
runtime dependency. A separate parent-authored harness passed **7/7 checks**:
visible feed reads matched a fresh native hierarchy, one `feed.next` changed both
author and caption, its replay did not advance twice, and the different query
**杭州西湖** returned captions equal to independently observed native result text.
The harness then independently confirmed the home landing screen. This extra
acceptance is not model output and is separate from the 23-check generated journey.

A deliberately faulty copy whose dispatch was a no-op and whose `matches()`
always returned true was rejected with `INDEPENDENT_WITNESS_FAILED`; independent
cleanup confirmed home. The original generated adapter was unchanged.

The [sanitized machine-readable acceptance](douyin-android-acceptance.json)
contains APK/adapter/tarball hashes, concrete checks, declared feature coverage,
and the interventions. The tarball SHA-256 is
`827fbb694a70608480f38f664ee030a67b3eaf8a38df8e7058593e390f7a04ae`.
The package was built locally; it was not published to the npm registry.

After acceptance, the home screen was independently confirmed, the test emulator
was closed, and its temporary ADB setting was restored to disabled. Port 5555
was verified to have no listener. Reopen and authorize a device before running
the CLI again. The remote temporary analysis directory was removed; original
analysis evidence remains private in the local run.
