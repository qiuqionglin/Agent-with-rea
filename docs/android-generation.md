# Generate an Android CLI from an APK

The target is [Bill Farmer's Editor](https://github.com/billthefarmer/editor), version 1.98 distributed by [F-Droid](https://f-droid.org/en/packages/org.billthefarmer.editor/). It is a real native Android text editor that had no adapter in this repository before the experiment. The input to generation is the APK, not its upstream source tree or a prewritten adapter.

## Reproduce

Prepare Node.js, an authenticated Codex CLI, REA 6.7.0, a full JDK and the pinned JADX provider as described in [automatic generation](generation.md). Use an authorized Android test device. This experiment used Android 13 on an ARM64 emulator with root disabled.

Download the pinned F-Droid APK and check its bytes:

```bash
mkdir -p .local/android
curl -fL https://f-droid.org/repo/org.billthefarmer.editor_198.apk \
  -o .local/android/editor-1.98.apk
echo '343d17e11d0914e1a7708df2781580a0413e52501c0a41d91f7ef725d9615fe9  .local/android/editor-1.98.apk' \
  | shasum -a 256 -c -
```

Then supply that APK to the common generator. Set `JAVA_HOME`, `REA_JADX_MCP_JAR` and, if needed, `REA_ADB_PATH` for your environment; replace the device serial below with one from `adb devices`:

```bash
node bin/app2cli.mjs generate .local/android/editor-1.98.apk \
  --allow-ui-fallback --id editor --out .local/generate/editor \
  --serial emulator-5554 --install --max-attempts 8 \
  --agent-model gpt-6.1-sol --agent-effort high \
  --goal "Read and replace the current text buffer through the original native app controls, verify the actual native editor text, and restore the original content. Choose a nontrivial ASCII test value, preserve unrelated state, and ground the mapping in REA class or method source."
```

Model flags affect only this invocation. `--codex-ignore-config` can additionally isolate a failing custom provider configuration while retaining the CLI's existing login. `--install` installs an absent package; it does not replace a mismatched installed APK.

The agent may request additional `inspect_android_class` and `inspect_android_method` probes. These consume the same bounded round budget as candidate generations. The runner retains the actual REA outputs, model responses, generated candidates, CLI subprocess output and test failures under the private run directory.

Use the environment and CLI path returned in `result.json`. Discover the generated commands using `--schema`. Repeat the complete test without another model call:

```bash
node bin/app2cli.mjs verify .local/generate/editor --out .local/verify/editor
node scripts/negative-generation-control.mjs \
  .local/generate/editor .local/negative-editor
```

The negative control creates a separate copy with a no-op dispatcher and a lying postcondition. The original agent-generated source remains unchanged. A correct observer must reject the copy and confirm restoration.

## Evidence and limits

See the [sanitized acceptance record](android-generation-acceptance.json) and [generated adapter](../examples/editor-generated/README.md) for the measured outcome, failures, model/source hashes and command domain. The actual APK, decompiled method bodies, local device settings, raw model traces and execution journals are excluded from Git and npm packages.

The tested capability is replacement of the current native text buffer. Native readback establishes what the installed app displays. It does not establish that a file was saved, that text survives app termination, or that any backend was modified. A restart **before** a verification scenario tests initialization; it does not prove persistence **through** a restart after writing.

The shared components are package discovery, APK pinning, REA probes, structured authoring, compilation, bounded failure feedback, CLI protocol checks, independent observations and restoration guards. App-specific mode transitions, controls, command semantics and supported input domains remain model-generated adapter code. A successful Editor example does not establish automatic support for arbitrary APKs.
