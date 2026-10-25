# TodoMVC recipe

This project-authored recipe operates the pinned, unmodified Knockout TodoMVC view model. It exposes list, get, create, rename, completion and deletion. Source-byte checks and a reload confirm persistence. It is a curated recipe, not an automatically generated adapter.

```bash
pnpm demo:web
app2cli run examples/todomvc --schema
```

Use the demo's private `.local/web/session.json` to select its CDP page. Set `APP2CLI_CDP` and `APP2CLI_TARGET`, then invoke `todos list`, `todos create --title <text>` and the other declared commands. Mutations must be confined to disposable test todos and cleaned up after acceptance.

See the [Web walkthrough](../../README.md#web-inspect-build-run), [architecture](../../docs/architecture.md) and [original acceptance summary](../../docs/cases/acceptance.json). The former `adapters/todomvc` CLI path remains compatible. Adapter source and manifest bytes have not changed.
