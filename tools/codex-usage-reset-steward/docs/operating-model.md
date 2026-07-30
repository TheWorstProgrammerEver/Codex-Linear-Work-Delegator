# Operating model

## One bounded invocation

The systemd timer starts a oneshot CLI. The CLI acquires a non-blocking kernel
`flock`, checks the synchronized clock and durable state, starts
`codex app-server --listen stdio://`, performs initialize/initialized, and
calls `account/rateLimits/read`. Stdio reuses the existing Unix user's Codex
session without reading, copying, or logging its credential files and without
opening a network listener.

The CLI then parses fresh normalized blocked-work evidence and evaluates the
pure policy. Consume mode repeats the mutable rate-limit, evidence, and kill
switch checks immediately before preparing an attempt. Dry-run returns before
the consume adapter is invoked.

The app-server subprocess receives only the environment entries needed for
Codex authentication and startup. Linear configuration and unrelated service
environment are not forwarded. Stderr, raw responses, credit IDs, and raw
exceptions are not logged.

## Attempt state machine

1. `prepared`: generate one UUID and durably write it before any consume call.
2. `dispatched`: durably record that the attempt may be in flight.
3. `outcome_received`: durably record one of `reset`, `alreadyRedeemed`,
   `nothingToReset`, or `noCredit`.
4. For `reset` and `alreadyRedeemed`, refresh rate limits before clearing the
   pending attempt and recording the 24-hour frequency timestamp.
5. For `nothingToReset` and `noCredit`, clear the attempt as a no-op.

An ambiguous transport failure retains `dispatched`. A retry within the
120-minute conservative recovery window uses the exact same UUID; it never
generates a second logical attempt. A crash after a known outcome resumes only
refresh/finalization and does not call consume again. An unknown response or
schema drift remains pending and fails closed.

A `prepared` attempt proves the consume call was not dispatched. Recovery
therefore repeats the mutable rate-limit, evidence, frequency, clock, owner,
policy, and kill-switch gates and requires the same work reference before
changing the phase to `dispatched`. Stale, missing, or different work leaves
the prepared record intact and consumes nothing.

An expired ambiguous attempt is deliberately not cleared automatically.
Activate the kill switch and reconcile it as an operator incident. Preserve
the idempotency key, inspect only redacted steward result classes and supported
account state, and never delete the pending record merely to restore progress.

## Files and permissions

The installed system service runs as the designated Unix user. systemd owns
the private directories:

- state: `/var/lib/codex-usage-reset-steward`, mode `0700`;
- audit: `/var/log/codex-usage-reset-steward`, mode `0700`;
- runtime lock: `/run/codex-usage-reset-steward`, mode `0700`.

State and audit files are mode `0600`. State publication writes, synchronizes,
renames, and synchronizes the containing directory before an external consume
effect. The state parser validates phase relationships, policy identity, file
type, owner, mode, link count, and no-follow opening.

Clock observations use the Linux boot ID and `/proc/uptime`, not Node process
uptime, so independent timer processes share one boot-scoped monotonic
baseline. Wall-clock and boot-uptime deltas must remain within the configured
skew while NTP reports synchronized.

Audit JSONL contains only timestamp, code/policy identity, mode, decision,
stable reason codes, work reference, coarse credit class, coarse exhausted
bucket flag, and result class. It does not include account usage values,
reset-credit counts or IDs, raw app-server payloads/errors, prompts, tokens, or
credentials.

## Operations

Installation rebuilds from `git archive` of the exact clean commit in a
private temporary directory as the designated unprivileged user. Ignored or
stale checkout build output is neither trusted nor copied into the immutable
release.

Inspect without exposing account values:

```bash
systemctl status codex-usage-reset-steward.timer
systemctl status codex-usage-reset-steward.service
systemctl list-timers codex-usage-reset-steward.timer
journalctl -u codex-usage-reset-steward.service --since today
```

The journal receives the same bounded safe summary as the CLI. The timer does
not purchase anything or fall back to a billing surface when no earned reset
is available.
