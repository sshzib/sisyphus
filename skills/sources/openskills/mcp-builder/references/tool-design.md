# Tool Contract Review

Use this checklist after identifying the service operations and before writing the server.

1. Map each tool to a user outcome, not merely an internal endpoint.
2. Give every tool an action-led, unambiguous name and a description that says when to use it.
3. Make required inputs explicit; constrain enums, sizes, IDs, and date formats.
4. Return the smallest useful result and support pagination or filtering for collections.
5. Separate read-only tools from mutation tools. A mutation must state its side effect, idempotency behavior, and confirmation requirement.
6. Do not expose secrets, raw upstream error bodies, or unbounded result sets.
7. Make errors actionable: name the failed input or dependency and the next safe action.

## Contract Record

For each tool, record its inputs, output shape, permission needed, destructive behavior, idempotency, pagination behavior, and representative success and failure examples. Test those examples against the actual upstream service.
