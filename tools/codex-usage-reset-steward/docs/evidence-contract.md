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

The included work/review producer launches `codex exec --json`, extracts only
its structured thread identifier, and calls authenticated local app-server
`thread/read` after the attached process exits. It accepts only the latest
failed turn's exact `codexErrorInfo: "usageLimitExceeded"` discriminator. It
then refreshes the Linear issue, verifies the current work/review status,
matching agent/reviewer label, and absence of unresolved blockers before
writing a private temporary file, synchronizing it, and atomically renaming it
into place.

Both producer profiles share
`~/.local/state/codex-usage-reset-steward/usage-limit-blocked.json`. Each
scheduler poll invalidates expired evidence or evidence whose refreshed Linear
work is no longer eligible. A new Codex launch clears prior evidence before
testing the account, and a completed non-limit run removes matching evidence.
Consume-enabled hosts must use attached delegator mode; detached compatibility
mode deliberately cannot publish a later child exit.

The evidence must not contain prompts, issue descriptions, arbitrary error
text, log paths, PIDs, account identifiers, tokens, credentials, rate-limit
values, or credit details. The strict parser rejects unknown fields so those
values cannot silently enter the authorization boundary.
