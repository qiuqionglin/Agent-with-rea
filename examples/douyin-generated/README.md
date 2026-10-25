# Generated Douyin Android adapter

`adapter.json` and `adapter.mjs` are copied unchanged from the actual model's
accepted candidate. They were generated from the pinned APK, retained REA
package/class/method evidence, approved native exploration, and a previously
passed navigation adapter. The search extension included an explicit review of
one erroneous test condition; see [the experiment record](../../docs/douyin-android.md).
It is not a claim of fully unattended or whole-app coverage.

The accepted five-screen journey passed 23 native checks. A separate installed-package harness also confirmed feed advancement, replay and a different Chinese search query against native observations; see the experiment record. `acceptance.json` is
runner-produced metadata, separate from model output. `test-plan.json` is the
fixed reviewed plan used for that run. No APK, decompiled method, credentials,
account state or raw native captures are included.

## Use

With the exact APK installed on an authorized Android device, configure
`APP2CLI_ANDROID_SERIAL`, `REA_ADB_PATH` and `APP2CLI_UIAUTOMATOR_PYTHON` as described
in the experiment record. Read commands are available directly from the checkout:

```bash
node bin/app2cli.mjs run examples/douyin-generated --schema
node bin/app2cli.mjs run examples/douyin-generated screen read
node bin/app2cli.mjs run examples/douyin-generated feed read
```

Build a standalone CLI against your retained, hash-matching REA evidence:

```bash
node bin/app2cli.mjs build examples/douyin-generated \
  --evidence .local/generate/douyin-search/evidence --out dist/douyin
```

A fresh build is runtime-unverified and does not automatically copy this
example's acceptance record. The original generated package does include its
own digest-bound acceptance. After installing a generated package:

```bash
douyin-cli --schema
douyin-cli --capabilities
douyin-cli home open --request-id home-001
douyin-cli feed read
douyin-cli feed next --request-id next-001
douyin-cli search open --request-id open-001
douyin-cli search submit --query "西湖风景" --request-id search-001
douyin-cli search results
douyin-cli home open --request-id home-002
```

`search.open` alone does not submit a search. `search.submit` requires the search
input page, enters Unicode text, touches the freshly observed search control,
and requires distinct result controls and nonempty native result captions.
`search.results` reads only currently exposed result content. There is no hidden
API pagination or claim of exhaustive result retrieval.

`feed.next` sends one native swipe and requires both a different exposed author
and a different caption. This conservative rule can reject a legitimate next
video by the same author, captions that remain identical, or content inaccessible
to Android's UI hierarchy. Inspect an uncertain result before retrying with a
new request ID.

Only logged-out browsing/search was authorized for this run. Login, personal
collections, following, messages, posting, live streams, downloads, settings and
commerce are not covered by these tests. The capability catalog explicitly
records unimplemented or user/login-dependent areas; ten declared commands do
not establish arbitrary daily-operation coverage.
