# Structured blocked-work evidence

The steward does not scrape arbitrary logs and does not accept model judgment
or a text match as authority. An eligible worker/reviewer integration must
atomically publish one versioned JSON document:

```json
{
  "schemaVersion": 1,
  "observedAt": "2030-01-01T00:00:00.000Z",
  "validUntil": "2030-01-01T00:15:00.000Z",
  "agentId": "my-agent",
  "purpose": "work",
  "classifier": "usageLimitExceeded",
  "source": "codex-app-server-v2-event",
  "limitId": "codex",
  "work": {
    "identifier": "ABC-123",
    "state": "in_progress",
    "eligible": true,
    "blockedBy": []
  }
}
```

Production policy accepts only the source-controlled agent allowlist. `work`
must be eligible, unblocked, and actively `in_progress` or `reviewing`;
unrelated queued work alone cannot authorize consumption. `observedAt` must be
no older than 15 minutes, `validUntil` must remain in the future, and the
configured bucket must match.

The producer should derive `classifier` from the structured Codex
`usageLimitExceeded` discriminator, verify the current Linear issue status and
dependency eligibility, write a private temporary file, synchronize it, and
atomically rename it into place. It must remove or invalidate evidence when
the process recovers, work finishes, eligibility changes, or the block has
another cause.

The evidence must not contain prompts, issue descriptions, arbitrary error
text, log paths, PIDs, account identifiers, tokens, credentials, rate-limit
values, or credit details. The strict parser rejects unknown fields so those
values cannot silently enter the authorization boundary.
