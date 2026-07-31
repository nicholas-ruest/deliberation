# Enforced dependency direction

```text
transport/runtime -> application -> domain
                         |
                         v
                  public contracts

infrastructure -> application/domain ports
```

- Domain code imports only its own domain modules and `src/shared/domain`.
- Application code imports its context domain, shared application/domain, and public contracts.
- Infrastructure implements ports and is never exported by a context root.
- Cross-context calls use `contracts` or published integration events; implementation imports and database joins are forbidden.
- Domain objects are not transport objects. Handlers map to versioned schemas explicitly.
- Context runtime roles own one database schema. Cross-schema grants are denied.

The executable check is `npm run architecture:check`. Architecture fixtures and context build checks are part of CI.
