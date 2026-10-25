# Linkding: generated multi-function backend CLI

`adapter.json` and `adapter.mjs` are unchanged copies of the accepted model candidate from a URL-only discovery run against the official Linkding demo. The generator did not receive a HAR, endpoint list or existing adapter. Commands: `bookmarks.list`, `bookmarks.search`, `bookmarks.get`, `bookmarks.create`, `bookmarks.update`, `bookmarks.delete`.

The adapter invokes discovered backend HTML form endpoints through the original browser session; it does not click the UI. Mutations are restricted to objects carrying the runtime `APP2CLI_NAMESPACE` ownership marker. Browser login/CSRF state remains required. Schema and capability output describe the actual supported inputs and unimplemented areas.

The accepted lifecycle, repeat verification and repository-external installation each passed 13 checks. The no-op update control failed independent GET verification and cleanup completed. One earlier pagination failure required a separate, recorded development cleanup; it is not counted as a successful generation attempt. See [workflow and limitations](../../docs/cases/application-generation.md) and [acceptance](../../docs/cases/application-generation-acceptance.json).

To generate a fresh instance, run `node bin/app2cli.mjs generate https://demo.linkding.link/`. The application is a shared public demo that resets periodically. Use only your generated test namespace; the accepted run's temporary bookmarks were removed.
