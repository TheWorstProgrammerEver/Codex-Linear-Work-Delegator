# Codex Linear Work Delegator

Local CLI for a Raspberry Pi Codex worker. It polls Linear with a normal API key, claims one eligible issue, and only then starts `codex exec`. The idle polling path uses no LLM/model tokens.

This is intentionally not Codex Cloud Tasks. Linear is the backlog and discussion surface; the Pi is the durable execution platform.

The production operating model is single-agent and single-task: one Pi runs one Codex issue at a time. The default attached execution mode keeps this wrapper alive until `codex exec` exits, so the systemd service remains active for the full Codex run and the timer does not schedule overlapping work.

## Example Usage

Install and build once:

```bash
npm install
npm run build
```

Create `.env.local` with a Linear API key:

```dotenv
LINEAR_API_KEY=<your-linear-api-key>
CODEX_LINEAR_TEAM_KEY=RYA
CODEX_LINEAR_AGENT_ID=my-agent
CODEX_LINEAR_AGENT_LABELS=agent:my-agent,agent:any
CODEX_LINEAR_CODEX_EXEC_MODE=attached
```

Preview the next claim:

```bash
npm start -- --dry-run
```

Run a live claim without starting Codex yet:

```bash
npm start -- --no-spawn
```

## Linear Setup

Recommended statuses:

- `Waiting For Agent`: eligible for pickup.
- `Agent In Progress`: claimed/running.
- `Blocked`: agent could not continue.
- `In Review`: agent believes work is complete and needs human review.
- `Agent Reviewing`: review-running status for the review runner.
- `Review Passed`: successful review status for the review runner.

Recommended labels:

- `agent:my-agent`: the agent named `my-agent` may pick it up.
- `agent:any`: any compatible local agent may pick it up.
- `agent:model:gpt-5.5`: use the strong/default model.
- `agent:model:gpt-5.4-mini`: use the cheaper/faster model for light work.
- `agent:reasoning:high`: pass `model_reasoning_effort` to Codex for this issue.
- `agent:speed:fast`: request Codex Fast mode for this issue.
- `agent:speed:standard`: force Fast mode off for this issue.
- Optional later: `agent:sandbox:workspace-write` or `agent:sandbox:danger-full-access`.
- `reviewer:my-agent`: the agent named `my-agent` may review it.
- `reviewer:any`: any compatible local reviewer may review it.

An issue is eligible when:

- its status matches `CODEX_LINEAR_READY_STATUS`;
- it has one of `CODEX_LINEAR_AGENT_LABELS`;
- it is not blocked by unresolved Linear dependency relations;
- it is not already marked busy in local worker state.

Linear may display/create this as a label group named `agent` with child labels such as the agent name (e.g. `my-agent`) or `any`. The CLI supports both forms: exact flat labels like `my-agent`, and grouped labels configured as `agent:my-agent`.

The CLI chooses the highest priority issue first, then oldest created issue.

Linear dependency relations are enforced before claim. If a ready candidate is
blocked by another issue whose status type is not `completed` or `canceled`, the
CLI logs the blocker identifiers, skips that candidate, and keeps scanning for
claimable work. Issues that only block downstream work remain claimable; those
downstream dependencies are included in the Codex prompt snapshot so the worker
understands what completion may unblock.

## Good Issue Shape

Put the work in the Linear issue itself:

- authoritative repository URL;
- exact task;
- acceptance criteria;
- verification command;
- constraints and non-goals;
- expected output, such as local change, commit, PR, or notes only.

For code-changing repository work, the default expected output is a pull request. Before moving the Linear issue to `In Review`, the spawned Codex worker is expected to create or use an issue branch, commit the change, push the branch, open or update a PR, and include the PR URL in the Linear completion comment. Use local-only, no-PR, notes-only, research-only, or another artifact only when the issue explicitly says so.

If the agent blocks, resolve the blocker and move the issue back to `Waiting For Agent`.

Example:

```markdown
Repo: https://github.com/example/repo.git

Task:
Add first-boot setup progress visibility.

Acceptance criteria:
- The boot-drive setup service writes human-readable status to a predictable file.
- The README explains how to inspect progress over SSH or local console.
- Existing tests still pass.

Verification:
- npm test
- npm run build

Constraints:
- Do not store secrets in generated images.
- Keep changes scoped to setup-progress visibility.
```

## Configuration

The CLI loads configuration in this order:

1. `.env.defaults`
2. `.env.local`
3. each `--env-file <path>`
4. process environment
5. CLI flags

Create `.env.local`:

```bash
LINEAR_API_KEY=<your-linear-api-key>
CODEX_LINEAR_TEAM_KEY=<linear-team-key>
CODEX_LINEAR_AGENT_ID=my-agent
CODEX_LINEAR_AGENT_LABELS=agent:my-agent,agent:any
```

Do not commit API keys.

## Run

```bash
npm install
npm run build
npm start -- --dry-run
npm start
```

Useful flags:

```bash
codex-linear-work-delegator --codex-exec-mode attached
codex-linear-work-delegator --codex-exec-mode detached --wait-timeout-seconds 60
codex-linear-work-delegator --env-file /etc/codex-linear-work-delegator.env
codex-linear-work-delegator --dry-run
codex-linear-work-delegator --no-spawn
```

Issue labels can override Codex launch options:

```text
agent:model:gpt-5.4-mini
agent:reasoning:low
agent:speed:standard
agent:sandbox:workspace-write
```

Speed labels are per-issue Codex CLI overrides:

- no `agent:speed:*` label: pass no speed or service-tier override, so the host `config.toml` defaults apply;
- `agent:speed:fast`: pass `--enable fast_mode` and `-c service_tier="fast"`;
- `agent:speed:standard`: pass `--disable fast_mode` and no `service_tier` override.

Use at most one speed label. Conflicting or unsupported `agent:speed:*` labels cause the delegator to leave a Linear comment, move the issue to `Blocked`, and skip spawning Codex.

Fast mode is a service-tier override for models that support it. This delegator currently allows Fast mode for `gpt-5.5` and `gpt-5.4`; `gpt-5.3-codex-spark` is a separate model label, not Fast mode. If an issue requests `agent:speed:fast` with a model that does not support Fast mode, the delegator blocks the issue instead of silently falling back.

Model labels, including `agent:model:gpt-5.3-codex-spark`, only select the Codex runtime. They are not a substitute for explicit completion criteria in the prompt or issue. Small or fast-model code tasks still need the branch, commit, push, PR, verification, and Linear completion-comment contract unless the issue explicitly requests a different artifact.

`CODEX_LINEAR_CODEX_EXTRA_ARGS` is appended after label-derived options, so static env args can intentionally override label-derived Codex config.

`CODEX_LINEAR_CODEX_EXEC_MODE` controls the Codex process lifecycle:

- `attached` is the default production mode. The wrapper starts `codex exec` as a normal child process and waits until it exits. `CODEX_LINEAR_WAIT_TIMEOUT_SECONDS` is ignored in this mode.
- `detached` preserves the older bounded-wait behavior for compatibility and testing. The wrapper detaches `codex exec`, waits up to `CODEX_LINEAR_WAIT_TIMEOUT_SECONDS`, then returns without killing the child. The child PID stays in local state so the next scheduled run can see that work is still active.

## Long-Running Resumable Jobs

Some Linear issues involve external work that can outlive a Codex session: large downloads, backups, imports, migrations, builds, or data-processing jobs. The spawned worker prompt tells agents not to foreground-monitor these jobs for hours. The Codex session should set up durable local execution, record recovery state, and yield once the next action is clear.

Expected shape for long-running work:

- run the external job with an inspectable durable runner such as `systemd-run`, a dedicated service/timer, `tmux`, or another detached host-appropriate process;
- write a small state file that records the job purpose, phase, artifact path or job identifier, log path, resumability notes, checksum/validation plan, and exact resume/reconcile command;
- route verbose progress to logs with quiet/non-TTY flags where possible, especially for transfer tools with progress meters;
- add a lightweight Linear status comment before yielding control, and add periodic status comments for intentionally incomplete long-running work;
- keep partial artifacts resumable and validate before marking the issue complete.

This keeps normal coding/research issues unchanged: short work should still be completed directly by the Codex run and follow the normal PR or notes-only completion contract.

## Scheduler Shape

Use a systemd timer to invoke the CLI. The installed schedule is intentionally single-worker: the service is `Type=oneshot`, stays active for the full attached Codex run, has no normal runtime timeout, and the timer uses `OnUnitInactiveSec=5min` so the next scan is scheduled only after the previous service invocation exits.

The local lock prevents multiple scheduled invocations on the same host from claiming multiple issues at once. Local busy state is an additional guard for manual runs; if the agent is already working, the CLI exits early with a clear busy message rather than claiming more work.

Example service:

```ini
[Unit]
Description=Codex Linear Work Delegator

[Service]
Type=oneshot
WorkingDirectory=/opt/codex-linear-work-delegator
EnvironmentFile=%h/.config/codex-linear-work-delegator/env
ExecStart=/usr/bin/npm start -- --env-file %h/.config/codex-linear-work-delegator/env
TimeoutStartSec=infinity
KillMode=control-group
User=my-user
```

Example timer:

```ini
[Unit]
Description=Poll Linear for local Codex work

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
```

Basic host install/uninstall scripts live under `scripts/`:

```bash
sudo ./scripts/install-schedule.sh
sudo ./scripts/uninstall-schedule.sh
```

Defaults:

- installs `codex-linear-work-delegator.service` and `codex-linear-work-delegator.timer` under `/etc/systemd/system`;
- runs as the invoking sudo user by default;
- reads env from `~/.config/codex-linear-work-delegator/env`;
- polls every 5 minutes after a 2 minute boot delay.

Override behavior with environment variables such as `TARGET_USER`, `ENV_FILE`, `REPO_DIR`, `ON_BOOT_SEC`, `POLL_INTERVAL`, `ACCURACY_SEC`, `SYSTEMD_DIR`, or `SYSTEMCTL_BIN`.

## Claim Behavior

When an issue is claimed, the CLI:

1. checks for likely abandoned `Agent In Progress` issues for this agent and comments for manual review without changing their status;
2. moves one eligible issue to `Agent In Progress`;
3. adds a concise claim comment;
4. fetches a compact claim-time issue snapshot with bounded description/comment text and lightweight status, label, team, assignee, project, cycle, and dependency context;
5. writes local state under `CODEX_LINEAR_STATE_DIR`;
6. spawns `codex exec` for the issue with that compact fallback snapshot in the prompt.

The startup health check treats labels configured in `CODEX_LINEAR_AGENT_LABELS` as directly relevant to `CODEX_LINEAR_AGENT_ID`. For `agent:any`, it checks the latest claim comment and only warns if that comment says this agent claimed the issue. It does not mark issues failed, kill processes, or infer failure from age alone.

When the startup health check finds an `Agent In Progress` issue without active local worker state, it comments for manual reconciliation instead of treating the work as failed. Operators or later agents should check issue comments, durable job state files, service/timer units, detached sessions, partial artifacts, and logs. If a durable job is active or resumable, leave the issue running and add a lightweight status comment with the current state and next resume/reconcile command. If the artifact validates, finish the issue normally. If recovery needs outside input, comment with the concrete blocker and move the issue to `Blocked`.

Codex is instructed to update Linear when complete or blocked:

- move to `In Review` with a summary when complete;
- move to `Blocked` with blocker notes when blocked.

For PR-producing work, the spawned prompt directs workers to `$HOME/codex-notes/runbooks/github-app-pr-workflow.md` when present and names the preferred GitHub App helper path: `codex-github-token --expires-at`, `codex-gh` for GitHub API/PR state, and `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=$HOME/.local/bin/codex-github-askpass git push ...` for authenticated HTTPS Git operations. If a push returns `403`, workers should verify token minting, installation repository access, askpass configuration, and a dry-run push before concluding that repository access is absent.

## Review Runner

`codex-linear-review-delegator` is a separate command/process for review automation. It reuses the Linear API client, issue snapshot, label parsing, Codex launch options, locking, and systemd installer, but defaults to a separate state directory: `~/.local/state/codex-linear-review-delegator`.

The committed `.env.defaults` intentionally does not set `CODEX_LINEAR_STATE_DIR`; leaving it unset lets the work and review commands choose separate profile defaults. Set `CODEX_LINEAR_STATE_DIR` only in a command-specific env file or installer invocation.

Use a separate review env file, or make sure `CODEX_LINEAR_STATE_DIR` points at review state. Reusing the work-runner env file unchanged can point the reviewer at `~/.local/state/codex-linear-work-delegator`, causing it to treat active implementation work as an active review.

An issue is eligible for review when:

- its status matches `CODEX_LINEAR_REVIEW_READY_STATUS`, default `In Review`;
- it has one of `CODEX_LINEAR_REVIEWER_LABELS`, default `reviewer:<agent-id>,reviewer:any`;
- it is not blocked by unresolved Linear dependency relations;
- no review is already active in the review runner state directory.

When a review is selected in apply mode, the runner:

1. checks for likely abandoned `CODEX_LINEAR_REVIEW_RUNNING_STATUS` issues for this reviewer and comments for manual recovery without changing their status;
2. moves one eligible issue to `CODEX_LINEAR_REVIEW_RUNNING_STATUS`, default `Agent Reviewing`;
3. adds a concise review-claim comment;
4. fetches a compact issue snapshot;
5. spawns `codex exec` with the reviewer prompt.

The startup health check treats labels configured in `CODEX_LINEAR_REVIEWER_LABELS` as directly relevant to `CODEX_LINEAR_AGENT_ID`. For `reviewer:any`, it checks the latest review-claim comment and only warns if that comment says this agent claimed the review. It does not mark reviews failed, kill processes, or infer failure from age alone.

The reviewer prompt tells Codex to classify the artifact, run narrow validation, leave GitHub inline comments plus an overall summary when reviewing PRs, and keep Linear comments concise. Required changes should move the issue to `CODEX_LINEAR_REVIEW_RETURN_STATUS`, default `Waiting For Agent`. Successful reviews should move the issue to `CODEX_LINEAR_REVIEW_PASSED_STATUS`, default `Review Passed`. If that status does not exist, the reviewer must treat it as a review-process setup blocker rather than silently substituting another status.

For GitHub PRs in apply mode, a successful review includes merge ownership. The reviewer should submit the successful GitHub review, verify ready state, checks, required approvals, unresolved review threads, mergeability, and the allowed merge method, then merge the PR before leaving the Linear success comment. If the only obstacle is draft state and the issue/completion evidence says the work is ready for automated review, the reviewer may mark it ready before merge. The Linear success comment must include the external review URL, the merged PR URL, and an explicit statement that the PR was merged. If the PR otherwise passes but cannot be merged, the reviewer should not route to `Review Passed`; they should move the issue to `Waiting For Agent` for work-caused merge blockers or `Blocked` for external/access/human-gate blockers, with a concise Linear comment naming the blocker.

### Momus Review Profile

Run Momus reviews with a separate env file and state directory from the implementation worker. A Daedalus-host Momus review profile should live at `/home/daedalus/.config/codex-linear-review-delegator/env` and include:

```dotenv
LINEAR_API_KEY=<review-linear-api-key>
CODEX_LINEAR_TEAM_KEY=RYA
CODEX_LINEAR_AGENT_ID=momus
CODEX_LINEAR_REVIEWER_LABELS=reviewer:momus,reviewer:any
CODEX_LINEAR_REVIEW_RUNNING_STATUS=Agent Reviewing
CODEX_LINEAR_REVIEW_PASSED_STATUS=Review Passed
CODEX_LINEAR_STATE_DIR=/home/daedalus/.local/state/codex-linear-review-delegator
CODEX_GITHUB_ENV=/home/daedalus/.config/codex-github/momus.env
```

`CODEX_GITHUB_ENV` is not consumed by this runner directly. The systemd unit loads it through `EnvironmentFile`, and spawned review runs inherit the service environment so GitHub helper commands inside the review use the Momus GitHub App profile.

Use advise mode for calibration or self-review tests:

```bash
npm run start:review -- --advise --issue-id RYA-105 --artifact-url https://github.com/example/repo/pull/123
```

Advise mode does not claim the issue, write comments, update statuses, commit files, or otherwise mutate Linear/GitHub. It writes the review result to the Codex run output/log only.

Install a separate review timer with the same installer:

```bash
sudo UNIT_BASE=codex-linear-review-delegator \
  UNIT_DESCRIPTION="Codex Linear Review Delegator" \
  TIMER_DESCRIPTION="Poll Linear for local Codex reviews" \
  NPM_SCRIPT=start:review \
  ENV_FILE=~/.config/codex-linear-review-delegator/env \
  ./scripts/install-schedule.sh
```

## Notes

- The Linear poller uses the Linear GraphQL API directly.
- Codex MCP OAuth remains useful for interactive sessions and for the spawned Codex worker.
- The scheduler should use a dedicated, revocable Linear API key.
- `LINEAR_API_KEY` is required even for `--dry-run`, because dry-run still performs the real Linear lookup and only skips claiming/spawning.
