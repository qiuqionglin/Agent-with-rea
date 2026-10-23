# Contributing

Start with `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm test`.

For a new adapter, follow [the adapter contract](docs/adapter-contract.md). Include the supported application version, analysis recipe, named commands and input schemas, runtime/session requirements, actual execution channel and verification level. Add a reproducible scenario and a sanitized result; distinguish fixture tests from a real client run.

Do not commit `.local/`, account/session data, device captures, downloaded APK/JAR files, or decompiled proprietary application source. The release uses an explicit npm file allowlist and `pnpm check:release` to check the package boundary.

For shared-runtime changes, cover the failure mode that motivated the change. Keep business logic in adapters. Re-run affected live scenarios when dispatch, readback, session handling or target pins change. CI only exercises kernel/compiler fixtures and packaging; it cannot establish real application coverage.

Builds require a new output directory so a prior reviewed artifact cannot be silently replaced. `provenance.json` describes build-time evidence and intentionally leaves `runtimeVerified: false`; a separate acceptance report establishes live execution.
