# Douyin browser API read example

This is a reviewed migration of earlier REA-analyzed Webpack bindings into the reusable API bridge. It is not an automatic-generation result. The original browser session handles authentication and request signing. No UI clicks or account mutations occur.

Commands: `profile.status` and `collections.list`. Both verify the account and retrieve the bounded collection list; more pages are explicitly rejected. The live account had an empty collection list, so nonempty-list parsing and pagination are not accepted coverage.

Use a user-owned Chrome CDP session on the exact `https://www.douyin.com/user/self` tab. Set `APP2CLI_CDP`, `APP2CLI_TARGET` and `APP2CLI_ACCOUNT_HASH` (the SHA256 of `douyin:` plus the UID from a separately verified account observation). Do not copy credentials into the adapter. The driver rejects changed account/source bytes. This example is deployment-specific; reanalyze changed bundles instead of bypassing the pin.

```bash
node bin/app2cli.mjs run examples/douyin-web collections list
```

For a distributable build, provide REA output for the pinned source mappings and an inspected real network capture. See [API-first documentation](../../docs/cases/api-first.md). The live test compiled against those private raw outputs, then repeated the read through the compiled package. Authentication and raw personal responses are excluded from the repository.
