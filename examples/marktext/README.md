# MarkText: generated Electron CLI

These adapter files are unchanged copies of the accepted model output from the installed MarkText 0.19.1 `.app` input. No caller-supplied API list, application-specific adapter or operation contract was provided. The framework discovered packaged sources, REA IPC/context-bridge evidence and the live editor; the agent requested creation of scratch input documents.

Commands: `document.open`, `document.read`, `document.edit`, `document.save`, `document.reopen`, `document.restore`. They call original editor methods and IPC. Independent renderer/file observations verified actual edit/save/reopen behavior, preserved a second fixture document and restored the original contents. The accepted run, repeat and independent installation each passed 18 checks; a no-op edit plus forged success was rejected.

Execution requires the pinned application, its owned running renderer, `APP2CLI_WORKSPACE` and `APP2CLI_NAMESPACE`. The namespace is supplied at runtime and is not compiled into the adapter. The example is restricted to its scratch Markdown documents. It is not a general file manager or full MarkText implementation.

Source selection, eight ASAR integrity contradictions and unavailable REA runtime-page inspection are explicitly disclosed in [the workflow](../../docs/cases/application-generation.md) and [acceptance](../../docs/cases/application-generation-acceptance.json). Observed ASAR hashes are not a publisher-authenticity assertion. The original application and extracted sources are not redistributed.
