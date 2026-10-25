# Application examples

These directories contain executable adapters and their documented evidence boundaries. Command availability is not whole-application coverage. See each README for the original target version, session requirements and actual accepted scenarios.

| Example | Platform / transport | Commands | Origin |
| --- | --- | ---: | --- |
| [booker-api](booker-api/README.md) | api / http | 2 | Unchanged agent-generated adapter |
| [dillinger](dillinger/README.md) | web / explicit fallback | 2 | Unchanged agent-generated adapter |
| [douyin-android](douyin-android/README.md) | android / explicit fallback | 10 | Agent-generated; reviewed journey oracle |
| [douyin-web](douyin-web/README.md) | web / browser-api | 2 | Reviewed original-client API bridge |
| [editor](editor/README.md) | android / explicit fallback | 2 | Unchanged agent-generated adapter |
| [fossify-calculator](fossify-calculator/README.md) | android / explicit fallback | 3 | Project-authored recipe |
| [linkding](linkding/README.md) | web / browser-api | 6 | Unchanged agent-generated adapter |
| [marktext](marktext/README.md) | electron / electron-api | 6 | Unchanged agent-generated adapter |
| [todomvc](todomvc/README.md) | web / explicit fallback | 6 | Project-authored recipe |

```bash
app2cli list
app2cli run examples/linkding --schema
app2cli run examples/marktext --capabilities
```

Schema and capability inspection do not connect to an application. Actual commands require the original live session and version pins. Build an example against its retained private REA evidence before installing its standalone CLI. Do not copy another person's credentials or raw captures.

All adapter.json and adapter.mjs files retain their pre-refactor bytes. The eight lib compatibility exports preserve their original imports; new generation uses #app2cli SDK imports. Former example paths remain recognized by the framework CLI. Curated recipes and generated outputs have distinct origins even though they share this directory.
