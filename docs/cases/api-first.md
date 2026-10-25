# API-first execution

The [product goal](../product-goal.md) is automatic application-to-CLI compilation from a URL or application artifact. The [URL/Electron application workflow](application-generation.md) now acquires its own discovery evidence. The HAR and API case inputs below describe the older explicit HTTP implementation and remain useful advanced inputs; supplying them manually is not the intended normal product workflow.

The preferred route is **observed requests → REA analysis → generated HTTP adapter → CLI execution → independent server GET**. Existing browser-function and Android UI drivers are explicit fallbacks. Discovering a client symbol does not by itself establish a replayable API.

## Implemented transports

| Transport | Invocation | Verification | Current scope |
| --- | --- | --- | --- |
| `http` | Node fetch, declared origin/method/path, runtime credential environment binding | A separate observer issues GET without importing the generated adapter | One owned resource, reversible top-level string-field replacement; HAR and caller-owned API case required |
| `browser-api` | Original Webpack client request export in the selected authenticated browser | Real response bytes and network metadata, reject cache/service-worker responses, compare native mapper with raw data | Reviewed read-only Douyin example; browser required; no automatic signed write generation |
| `browser-function` / `native-ui` | Existing native functions or Android controls | Independent DOM/native UI observer | Available only with explicit fallback in new generation runs |

The policy prevents silent fallback; it is not a claim that arbitrary URLs/APKs now yield APIs. An APK alone cannot supply login state, dynamic signatures or a proven endpoint contract. Android private API recovery and client instrumentation remain future work. The existing Douyin Android example is still UI-based.

## Direct HTTP generation

Capture actual requests for an operation you may perform on your own test resource. Keep the HAR private and remove credentials before retaining it. Supply an API case that pins the backend origin, credential variable name, resource parameter names, ownership assertions, mutable field and independent GET. The actual credential value stays in the calling environment; the model receives only its binding metadata. Resource environment values are saved in the private run, so never use credential variables as resource parameters.

For example, the public Restful Booker API playground accepts this case shape (replace the owner assertions with those of a resource you created):

```json
{
  "schemaVersion": 1,
  "field": "additionalneeds",
  "owner": {"firstname": "REAAPI", "lastname": "YOUR_UNIQUE_TEST_MARKER"},
  "config": {
    "baseUrl": "https://restful-booker.herokuapp.com",
    "auth": {"type": "header", "header": "cookie", "env": "APP2CLI_API_TOKEN", "prefix": "token="},
    "parameters": {"bookingId": "APP2CLI_BOOKING_ID"},
    "operations": {
      "observe": {"method": "GET", "path": "/booking/{bookingId}", "statuses": [200]}
    }
  }
}
```

```bash
# Inject APP2CLI_API_TOKEN and APP2CLI_BOOKING_ID in your own environment.
node bin/app2cli.mjs generate https://restful-booker.herokuapp.com \
  --id booker-api --transport http \
  --capture .local/requests.har --api-case .local/owned-resource.json \
  --out .local/generate/booker-api \
  --agent-model gpt-6.1-sol --agent-effort high
```

Both `--capture` and `--api-case` also select HTTP when `--transport` is omitted. REA inspects the supplied HAR; the generator does not invent capture evidence or automatically obtain an authenticated HAR from any URL. The agent infers the update binding from the recorded exchanges and emits a declarative contract. `lib/http-adapter.mjs` supplies the reusable resource read/replace implementation; `config.field`, `config.owner`, and `config.updateMode` select the observed field and field-only PATCH or full-resource PUT behavior. The generated module imports that factory instead of duplicating the runtime. This factory intentionally supports only one top-level string field and declares `resource.read` / `resource.set`. The runner checks schema, dry-run preservation, real mutation, independent GET, unchanged unrelated fields, separate-process reads, request replay, stale-revision rejection and complete restoration. Ownership mismatch stops verification before an automatic mutation. A public shared playground may reset/reuse IDs, so a stale fixture must be reprovisioned and revalidated; do not remove the ownership guard to pass.

Ordinary generated HTTP commands use neither a browser nor REA/Codex. A build currently includes the common SDK/dependencies, so the package may still contain browser support libraries. Runtime environment variables must be supplied again for verification or installation elsewhere. `NODE_USE_ENV_PROXY=1` with your HTTP(S)_PROXY can be used on Node 24 when your network requires it.

## Signed client API bridge

[The Douyin example](../../examples/douyin-web/README.md) migrates the earlier REA-derived client binding into `lib/browser-api.mjs`. Public source bytes are pinned; factory `toString()` hashes are not used. The bridge calls declared GET exports while observing the original request chain. Cookies and signatures remain in the browser; proof contains origin/path/status/body hash, never the signed query or credential headers. Its account guard uses a previously verified account hash.

This is a reviewed migration, not a fresh automatically generated adapter. Automatic generation of private signed-client SDK writes still lacks an independent signed-write observer. The separate application workflow supports discovered same-origin HTTP/form mutations, as verified on Linkding; that does not establish signed SDK write coverage. The example does not expose posting, messages, follows, collection writes or unbounded pagination.

## Failure behavior and limits

- Direct HTTP refuses redirects and cross-origin path changes, caps JSON bodies, validates declared response schemas and reports 401/403/409/412/429 explicitly.
- Mutations are never automatically retried by the HTTP driver. A transport interruption may mean the server already committed; the runtime journal preserves uncertain outcomes. Local request IDs do not establish distributed exactly-once behavior.
- State revisions detect changes between CLI reads. Without an actual server conditional-write contract, they do not prevent every external concurrent writer race.
- Auth is currently a header bound to an environment variable. Automatic token refresh, OAuth enrollment, cookie jars, multi-step auth and general pagination are not implemented.
- Independent GET is separate from the adapter, but uses the same small HTTP transport. Protocol fixtures cover that transport; live acceptance is reported separately.
- Adapter source is trusted local code. Evidence/transport labels are checked metadata, not a sandbox or formal proof of arbitrary generated behavior.

See [live API acceptance](api-first-acceptance.json) for the exact tested scope, failures and fixture lifecycle.
