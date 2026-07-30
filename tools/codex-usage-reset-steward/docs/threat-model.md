# Threat model

| Threat | Control |
| --- | --- |
| Credential disclosure | Local app-server stdio; existing user session; narrow child environment; no auth-file parsing/copying; bounded errors |
| Unauthorized redemption | Dry-run source default; exact policy SHA-256 pinned in code and installation; designated owner; root-controlled kill switch; no force command |
| Duplicate redemption | Kernel single-writer lock; persist-before-send UUID; exact-key ambiguous retry; `alreadyRedeemed` is success |
| Multi-host double use | Daedalus is the sole v1 writer; local locks are not represented as a cross-host lease |
| Forged, stale, or unrelated urgency | Structured discriminator; strict schema; short TTL; agent/bucket/work/eligibility match; authoritative account state |
| Billing scope expansion | Client interface exposes read and earned-reset consume only; no purchase, top-up, plan, spend-control, or billing method |
| Clock manipulation | NTP synchronization, boot identity, Linux boot-uptime/wall-clock comparison across timer processes, rollback/skew rejection |
| Unreviewed build output | Dirty-check plus unprivileged rebuild from the exact Git tree; ignored checkout `dist/` is never installed |
| TOCTOU | Exclusive lock and repeated rate-limit/evidence/kill-switch preflight immediately before durable preparation |
| Crash or ambiguous transport | Durable `prepared`/`dispatched`/`outcome_received` phases; prepared recovery revalidates mutable authority; dispatched retry reuses the same UUID; refresh after successful outcomes |
| Sensitive audit output | Allowlisted fields and stable codes; no raw responses/errors, usage values, credit IDs/counts, prompts, tokens, or credentials |
| Schema drift | Strict required types and enum validation; unknown reached types/outcomes fail closed |

The same-user boundary is explicit: a process that fully compromises the
designated Unix user can already access that user's Codex session and steward
state. systemd hardening and private modes reduce accidents and lateral
exposure; they do not claim to defeat full same-user compromise.

The v1 topology deliberately has one account writer. Deploying consume mode on
another host or agent requires a separately designed shared lease and a new
review; copying this installation is not supported.
