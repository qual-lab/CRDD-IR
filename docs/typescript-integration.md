# TypeScript target

The `typescript` target generates transport-neutral application boundaries:

- immutable input, state, output, and event DTO types;
- dependency-free runtime validators;
- synchronous or asynchronous handler contracts;
- cancellation and idempotency context;
- stable operation, execution, event, and CRDD trace metadata.

It does not choose Electron IPC, HTTP, WebSocket, React, a database, or a
server framework. Those bindings can wrap the generated handler without
changing Core IR.

## Generate one operation

```powershell
node .\tools\CRDD-IR\src\cli.ts generate typescript `
  <contract.md> `
  --out-dir .\generated\typescript
```

No target profile is required.

## Generate a batch

```powershell
node .\tools\CRDD-IR\src\cli.ts batch typescript `
  <first-contract.md> `
  <second-contract.md> `
  --out-dir .\generated\typescript
```

Batch generation uses the standard ownership manifest and refuses to overwrite
files that no longer match their generated hash.

## Adapter boundary

Application code implements the generated handler:

```ts
export class QueryHandler implements QueryRecordHandler {
  execute(input: QueryRecordInput, context: QueryRecordContext) {
    return repository.find(input.id);
  }
}
```

An Electron adapter validates `ipcRenderer.invoke` input and calls the handler.
An HTTP adapter validates request JSON and calls the same handler. A test can
call it directly. Transport-specific status codes and channel names remain
outside Core IR unless declared through a versioned extension.
