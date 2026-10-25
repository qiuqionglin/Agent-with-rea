# QQ desktop: inspection passed, business API execution not established

The tested client was **QQ for macOS 7.0.2-53644**. The user authorized temporary
loopback debugging and **read-only** tests. QQ was restored to its normal logged-in
state afterwards. No messaging, contact/group changes or account-setting changes
were tested. **No QQ business API was verified and no functional QQ CLI was
generated.** This is an unsupported-target experiment, not a passing application
acceptance case. See the [sanitized report](qq-inspection.json).

## Observed boundaries

QQ keeps a manifest under `Contents/Resources/app/package.json` whose main points
into `application.asar`. Its native framework is named `QQNT.framework`, and the
visible renderer uses an `app://` URL. The earlier driver assumed `app.asar`,
`Electron Framework.framework` and a `file://` renderer.

The selected ASAR entrypoint is an 80-byte resource that fails UTF-8 decoding.
Its exact encoding was not determined. REA analyzed three plaintext bootstrap
modules outside the archive. Those modules invoke a native loader; the selected
source slice yielded no context-bridge members or IPC channels. This does **not**
mean QQ has no such APIs. Most application behavior was outside the analyzed
plaintext slice.

REA inspected the actual regular binary inside the branded framework. Enabled
Inspector-related fuse bits did not establish usable runtime access:

| Attempt | Observed result |
| --- | --- |
| Start with a literal-loopback renderer debugging port | Flags were visible on the launcher, absent from the active kernel process; the requested CDP endpoint was unavailable |
| Activate the main Inspector with the standard signal | Kernel process exited; no Inspector endpoint appeared; the client was subsequently restored |
| Start with a process-local Inspector `NODE_OPTIONS` value | Electron logged that most Node options are unsupported in packaged apps; no usable Inspector endpoint appeared |
| Standard developer-tools shortcut | No developer-tools window was observed |

The startup and signal probes are environment interventions. They are retained
as failed attempts and never counted as successful API calls. A first static
analysis failed because the local default SDK did not match its Swift compiler;
repeating with a compatible per-process `SDKROOT` succeeded. No global SDK or
system security settings were changed.

## Reusable changes

`inspect electron <app> --out <new-directory>` now performs static inspection
without starting the client. It resolves a manifest-selected archive, pins its
bytes and actual entrypoint, finds a branded in-bundle framework binary, and
excludes non-UTF-8 resources from JavaScript exports. Literal control characters
in valid UTF-8 minified JavaScript remain supported, as required by MarkText.

`generate` now reports `DESKTOP_BRIDGE_REQUIRED` for these unsupported inputs
before starting a process. The original failure was a missing-file error; the
new diagnostic identifies the missing bridge without emitting an empty adapter
or inventing successful functions.

Framework fixtures cover standard and alternate layouts, entrypoint resolution,
nontext-source rejection before launch, and framework path containment. They do
not establish QQ runtime readiness. The existing multi-command application
acceptance mode also requires mutations; a dedicated read-only business-API
scenario remains to be implemented before it can accept a QQ read-only adapter.

The next required work is a supported bridge through QQ's native loader/IPC
boundary plus independent read-only verification. Static symbol or fuse discovery
alone cannot substitute for an actual call and observed result. Private account
state, raw application code and runtime captures are excluded from the repository.
