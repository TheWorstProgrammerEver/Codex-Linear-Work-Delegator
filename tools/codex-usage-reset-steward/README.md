# Codex Usage Reset Steward

This independently deployable package contains a deterministic local steward
for earned Codex usage resets. It reads account rate-limit state through
`codex app-server` over stdio, evaluates a fixed fail-closed policy, and can
redeem at most one earned reset when every gate passes.

It cannot purchase credits, enable top-up, alter billing or plans, change
workspace spend controls, expose a network listener, or bypass its policy. The
source default is dry-run. Routine tests and synthetic validation never call
the real consume method.

Source issue:
[RYA-217 - Implement and deploy Codex usage reset steward](https://linear.app/ryan-hayward/issue/RYA-217/implement-and-deploy-codex-usage-reset-steward).
Design:
[RYA-167 - Design source-controlled Codex usage reset steward](https://linear.app/ryan-hayward/issue/RYA-167/design-source-controlled-codex-usage-reset-steward).

## Conservative policy

The exact source-controlled values are in
[`config/policy.default.json`](config/policy.default.json). Its SHA-256 is
compiled into the steward, and consume mode additionally requires the same
digest through `CODEX_RESET_STEWARD_APPROVED_POLICY_SHA256`.

| Gate | v1 value |
| --- | --- |
| Source default | `dry-run` |
| Single designated owner | `daedalus` |
| Structured evidence agents | `daedalus`, `momus` |
| Eligible bucket | `codex` |
| Evidence maximum age | 15 minutes |
| Natural reset minimum delay | 8 hours |
| Consume window | 22:00–07:00 `Australia/Perth` |
| Credit validity floor | 5 minutes |
| Automated frequency | at most one per rolling 24 hours |
| Ambiguous pending replay window | 120 minutes |
| Clock skew tolerance | 120 seconds, with NTP synchronization required |

The steward also requires:

- an ordinary `rate_limit_reached` classification, not workspace credit,
  billing, or spend-control depletion;
- an exhausted configured primary or secondary window;
- authoritative earned-reset availability;
- fresh structured `usageLimitExceeded` evidence tied to eligible,
  unblocked in-progress worker or reviewer work;
- a stable synchronized clock, an exclusive kernel lock, no kill switch, a
  matching owner, and the approved policy digest.

Missing, stale, inconsistent, malformed, or unknown data blocks consumption.
Dry-run may inspect at any hour; its decision output and JSONL audit omit
usage percentages, reset times, reset-credit counts and IDs, credentials, and
raw upstream errors.

## Commands

```bash
npm ci
npm run check
npm run check:app-server-contract
npm run build

node dist/src/cli.js --help
CODEX_RESET_STEWARD_POLICY="$PWD/config/policy.default.json" \
  node dist/src/cli.js synthetic-check
```

`synthetic-check` uses an in-process fake account and fake `nothingToReset`
outcome. It does not start app-server and cannot redeem a real reset.

For a live read-only dry-run:

```bash
CODEX_RESET_STEWARD_MODE=dry-run \
CODEX_RESET_STEWARD_POLICY="$PWD/config/policy.default.json" \
CODEX_RESET_STEWARD_STATE_DIR="$HOME/.local/state/codex-usage-reset-steward" \
  node dist/src/cli.js run
```

Do not set consume mode merely to validate installation.

## Installation and emergency stop

Installation is gated on an independent review of the exact policy, code,
credential boundary, and tests. After that review:

```bash
sudo scripts/install.sh dry-run
# Run installed read-only and synthetic validation.
sudo scripts/install.sh consume
```

The installer refuses a dirty checkout, exports the exact Git commit into a
private temporary directory, and rebuilds there as the unprivileged designated
user. It never installs the checkout's ignored `dist/` bytes. The immutable
release retains the compiled CLI, policy, and systemd units from that reviewed
tree. A root-owned `codex-home` symlink under the steward's `/etc` directory
lets the systemd namespace grant the designated user's existing Codex home the
minimum write access app-server requires. Authentication material remains in
that existing home and is neither copied nor logged. Every install pass
reloads, enables, and restarts the timer so a dry-run-to-consume reinstall
cannot leave an elapsed timer without a future trigger.

The installed units are:

- `codex-usage-reset-steward.service`
- `codex-usage-reset-steward.timer`

The obvious root-controlled kill switch is:

```text
/etc/codex-usage-reset-steward/disabled
```

Stop immediately without deleting state:

```bash
sudo touch /etc/codex-usage-reset-steward/disabled
sudo systemctl disable --now codex-usage-reset-steward.timer
```

Rollback uses the previous immutable release retained under
`/opt/codex-usage-reset-steward/releases/`: repoint the `current` symlink to the
reviewed release, run `systemctl daemon-reload`, and restart only after a
dry-run. Uninstall by disabling the timer and removing the two unit files,
`current` symlink, and `/etc/codex-usage-reset-steward`; preserve
`/var/lib/codex-usage-reset-steward` and
`/var/log/codex-usage-reset-steward` until audit and pending-state
reconciliation is complete.

See [operating model](docs/operating-model.md),
[evidence contract](docs/evidence-contract.md), and
[threat model](docs/threat-model.md).
