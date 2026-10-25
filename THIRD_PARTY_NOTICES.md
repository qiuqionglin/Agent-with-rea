# Third-party notices and provenance

Project-authored code in this repository is licensed under MIT. Dependencies retain their original copyright and license notices in their installed packages. This file does not replace those notices.

| Component | Source / pin | Declared license / distribution |
| --- | --- | --- |
| REA | [morluto/rea](https://github.com/morluto/rea), npm `rea-agents@6.7.0` | REA-authored code MIT; its third-party notices apply separately. Dependency, not copied source |
| Ajv | npm `ajv@8.20.0` | MIT; runtime dependency |
| Playwright Core | npm `playwright-core@1.58.2` | Apache-2.0; runtime dependency, browser supplied separately |
| xmldom | npm `@xmldom/xmldom@0.9.12` | MIT; runtime dependency |
| TodoMVC | [upstream commit](https://github.com/tastejs/todomvc/tree/ff43b02e59dfa604386bb382034b2cd07c2bcd8a) | MIT; original application and license downloaded unchanged for the local example |
| Knockout, Director, TodoMVC styles/common | Pinned development dependencies in package/lock files | Original licenses retained by their packages |
| Fossify Calculator | [source tag 1.4.0](https://github.com/FossifyOrg/Calculator/tree/1.4.0), `calculator-10-foss-release.apk` | GPL-3.0; separately downloaded and installed, APK and decompiled source not shipped here |
| JADX headless MCP | [v0.7.1](https://github.com/1013503897/jadx-headless-mcp/releases/tag/v0.7.1), revision `5844800a486d2248fa949b74c9896285f5b54de2` | External analysis provider; its own distribution terms apply, JAR not shipped here |
| Dillinger | [live application](https://dillinger.io/), source hashes in the generated recipe | Used as an independent live test target. Client bundles are retained only in private analysis evidence; this repository ships the generated adapter and a test screenshot, not the application source |
| Editor | [Bill Farmer's Editor v1.98](https://github.com/billthefarmer/editor/tree/v1.98), [F-Droid package](https://f-droid.org/en/packages/org.billthefarmer.editor/) | GPL-3.0-only; APK and decompiled source are downloaded/analyzed privately and are not shipped. The generated adapter and native test screenshots are separate experiment artifacts |

Pinned downloads:

```text
Fossify Calculator APK
7c5443c22d6d62c67dfe80df33ea9161ff0fa440f92590bcb45d7008b57613ed

JADX headless MCP 0.7.1 JAR
6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75

TodoMVC Knockout js/app.js
fc01edc03a90a4e7569755bc3b8ab7b5015768980cdfebfaa4251f55c894a698

Editor 1.98 F-Droid APK (org.billthefarmer.editor_198.apk)
343d17e11d0914e1a7708df2781580a0413e52501c0a41d91f7ef725d9615fe9
```

Adapters are project-authored mappings, not upstream implementation files. Analysis outputs are produced by REA and its configured providers; execution/acceptance summaries are produced by this framework. Raw analysis can contain target code or personal state and is excluded from source control and npm packages.
