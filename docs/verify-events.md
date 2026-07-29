# Verify lock events

CRDD-IR serializes the complete Unreal verification pipeline per `.uproject`.
Each invocation appends machine-readable JSON Lines events to:

```text
<project-root>/.crdd-ir/verify-events.jsonl
```

Every line conforms to `schemas/verify-event.schema.json`. Events belonging to
one invocation share a `runId`:

```text
verify.lock.waiting
verify.lock.acquired
verify.lock.released
```

A timed-out invocation emits `verify.lock.timeout` instead of `acquired` and
`released`. The acquired event records `waitMilliseconds` and whether Windows
recovered an abandoned mutex. The released event records `holdMilliseconds`
and the verification outcome.

`unreal-build-evidence.json` includes the matching acquisition measurement
under `verificationLock`. Runtime timing is intentionally excluded from
`hashes.identitySha256`, so the same verified product inputs retain a stable
identity across machines and queue conditions.

CI consumers can stream the JSONL file and group events by `runId`. The file is
append-only operational evidence and should normally be retained as a CI
artifact rather than committed to Git.
