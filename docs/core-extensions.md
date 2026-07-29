# Core IR Extensions

CRDD IR Core is domain- and target-neutral. Its stable semantic surface is:

- operation identity and traceability
- typed input and state
- requirements and errors
- state effects
- transaction and rollback semantics

Optional domain or target data belongs under `operation.extensions`.

```yaml
extensions:
  com.example.audit:
    protocol: example/audit-v1
    data:
      category: audit
```

Extension IDs use lowercase reverse-domain-style names. The Core validates only
the envelope (`protocol` and `data`). The target or extension owner validates
the data payload. This prevents Unreal, Unity, 3D, web, server, or business
rules from becoming Core IR semantics.

## 3D asset extension

3D asset declarations use the extension envelope:

```yaml
extensions:
  crdd.3d-assets:
    protocol: crdd-ir/3d-assets-v0.1
    data:
      assets: []
```

The `assets` target owns validation of geometry, material, collision, LOD, and
placement. Core IR does not define asset semantics.
