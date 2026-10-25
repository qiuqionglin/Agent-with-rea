# Dillinger: output from the automatic generator

This adapter was **not present before the experiment**. It was returned by an actual Codex run from the live `https://dillinger.io/` URL and REA evidence. `adapter.mjs` is copied byte-for-byte from the model's structured final response; it has not been manually edited. The generator does not load this example as an input or template.

The successful clean run passed its eight real-application checks on the first candidate, including native replacement, independent preview read after reload and restoration of the initial document. Earlier development runs exposed capture-integrity, contract-format, transient-provider and brittle version-check failures; those are disclosed in the acceptance summary. This snapshot is not evidence that every earlier run succeeded.

The generated commands are:

```bash
dillinger-cli document read
dillinger-cli document replace --body "Hello from an agent" --request-id edit-001
```

The module uses the original application's document store, `updateDocumentBody` and `persist`, and observes the native editor and preview. It verifies browser-local persistence, not a cloud backend write. It preserves the observed document collection and settings. Source pins identify the tested deployment; reanalyze when they change.

To build this saved recipe manually against freshly captured evidence:

```bash
node bin/app2cli.mjs inspect web "$APP2CLI_CDP" --target "$APP2CLI_TARGET" --out .local/evidence/dillinger
node bin/app2cli.mjs build examples/dillinger-generated --evidence .local/evidence/dillinger --out dist/dillinger
node dist/dillinger/cli.mjs --schema
```

For a new automatic attempt, use `app2cli generate https://dillinger.io/ --allow-ui-fallback --out .local/new-dillinger`; no existing recipe is selected. The recorded acceptance covers a particular random plain-text replacement and restoration of the initial Markdown document. It is not exhaustive testing of arbitrary Markdown edge cases or all Dillinger features.

See [generation acceptance](../../docs/generation-acceptance.json) and [generation guide](../../docs/generation.md). Private raw REA output, model traces, browser profiles and journals remain outside the published repository. `provenance.json` records their hashes without claiming that this summary is a native trace.
