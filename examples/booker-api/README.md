# Automatically generated HTTP resource CLI

These two files are byte-for-byte copies of the successful model candidate. The model inferred the endpoint contract from actual REA-inspected HTTP exchanges and imported the shared resource adapter factory. No manual adapter edits were made. Generation used `gpt-6.1-sol` / `high` for this invocation only.

Target: the public [Restful Booker API playground](https://restful-booker.herokuapp.com/apidoc/index.html), not a production booking system. The final run passed 8/8 checks on its first candidate, including real PATCH, independent GET, unchanged unrelated fields and restoration. Earlier development runs and the shared-backend reset failure are disclosed in [the acceptance record](../../docs/cases/api-first-acceptance.json).

Commands are `resource.read` and `resource.set --value TEXT`. The module uses Node HTTP directly; no browser is started. Credentials and resource ID are environment bindings. The ownership marker in the manifest identifies this test's disposable resource; that resource was not provided for reuse. Create your own fixture and generate a new contract using [the API-first instructions](../../docs/cases/api-first.md). Do not substitute an arbitrary public record ID.

The example is intentionally bounded to a reversible top-level string replacement. It does not establish general booking workflows, production authentication, arbitrary APIs or full application coverage. Raw HARs, credentials, resource IDs, private test output and model trajectories remain outside the public repository.
