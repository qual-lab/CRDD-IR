# General application IR

CRDD IR models application contracts independently from transport, runtime,
database, UI framework, and deployment target.

## Operation kinds

`kind` is required and must be either `command` or `query`.

- `command` may change state and requires atomic rollback when it declares
  effects.
- `query` is read-only, permits empty requirements/errors/effects, and may omit
  `transaction`.

Both kinds may declare an `output` field schema.

## Portable field algebra

Fields can be scalar (`number`, `integer`, `string`, `boolean`), recursively
nested `object`, any typed `array`, typed `map`, or a discriminated `union`.
All field shapes may be optional or nullable. Scalar, string, and collection
constraints remain part of the source contract rather than a target-specific
validator.

Union variants are objects. Each variant must contain the discriminator as a
string field with exactly one enum value.

## Execution and events

`execution.mode` distinguishes synchronous and asynchronous operations.
Asynchronous contracts can declare cancellation, a positive timeout, and an
idempotency policy. `emits` declares target-neutral event payload and delivery
semantics.

These fields define portable meaning. Electron IPC, HTTP, WebSocket, SQLite,
Python, and TypeScript bindings belong in versioned extensions and target
adapters.

## Target compatibility

The canonical `ir` target supports every Core field by preserving it.
The current Unreal and Unity adapters remain state-transition adapters. They
fail closed for queries, asynchronous execution, and application field shapes
they cannot yet project. They never silently discard output or event semantics.

See:

- `test/fixtures/contracts/read-contract.md` verifies a nullable read-only
  contract without prescribing an application repository layout.
- `test/fixtures/contracts/background-contract.md` verifies an asynchronous,
  idempotent contract and a discriminated completion event.
- `typescript-integration.md` for generated DTOs, validators, handler
  boundaries, and transport adapter guidance.
