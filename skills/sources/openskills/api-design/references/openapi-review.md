# OpenAPI Contract Review

- Give every operation a stable `operationId`, summary, tags, and explicit success and error responses.
- Define reusable request, response, error, and pagination schemas under `components`.
- Mark required properties, formats, bounds, enums, nullability, and examples accurately.
- Specify authentication and authorization expectations per operation.
- Document cursor semantics, sort order, filtering, idempotency, and rate-limit responses where applicable.
- Treat removing a field, narrowing a type, changing authentication, or changing observable behavior as a compatibility review trigger.

Validate the document with the generator or linter used by the target project; a syntactically valid contract can still be behaviorally incorrect.
