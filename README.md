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
CODEX_LINEAR_AGENT_LABELS=agent:daedalus,agent:any
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

Recommended labels:

- `agent:daedalus`: this Pi may pick it up.
- `agent:any`: any compatible local agent may pick it up.
- `agent:model:gpt-5.5`: use the strong/default model.
- `agent:model:gpt-5.4-mini`: use the cheaper/faster model for light work.
- `agent:reasoning:high`: pass `model_reasoning_effort` to Codex for this issue.
- `agent:speed:fast`: request Codex Fast mode for this issue.
- `agent:speed:standard`: force Fast mode off for this issue.
- Optional later: `agent:sandbox:workspace-write` or `agent:sandbox:danger-full-access`.

An issue is eligible when:

- its status matches `CODEX_LINEAR_READY_STATUS`;
- it has one of `CODEX_LINEAR_AGENT_LABELS`;
- it is not blocked by unresolved Linear dependency relations;
- it is not already marked busy in local worker state.

Linear may display/create this as a label group named `agent` with child labels such as `daedalus` or `any`. The CLI supports both forms: exact flat labels like `daedalus`, and grouped labels configured as `agent:daedalus`.

The CLI chooses the highest priority issue first, then oldest created issue.

Linear dependency relations are enforced before claim. If a ready candidate is
blocked by another issue whose status type is not `completed` or `canceled`, the
CLI logs the blocker identifiers, skips that candidate, and keeps scanning for
claimable work. Issues that only block downstream work remain claimable; those
downstream dependencies are included in the Codex prompt snapshot so the worker
understands what completion may unblock.

## Good Issue Shape

Put the work in the Linear issue itself:

- repo and local path;
- exact task;
- acceptance criteria;
- verification command;
- constraints and non-goals;
- expected output, such as local change, commit, PR, or notes only.

For code-changing repository work, the default expected output is a pull request. Before moving the Linear issue to `In Review`, the spawned Codex worker is expected to create or use an issue branch, commit the change, push the branch, open or update a PR, and include the PR URL in the Linear completion comment. Use local-only, no-PR, notes-only, research-only, or another artifact only when the issue explicitly says so.

If the agent blocks, resolve the blocker and move the issue back to `Waiting For Agent`.

Example:

```markdown
Repo: /home/daedalus/github/TheWorstProgrammerEver/Codex-Create-Agent-Boot-Drive-CLI

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
CODEX_LINEAR_TEAM_KEY=DAE
CODEX_LINEAR_AGENT_ID=daedalus
CODEX_LINEAR_AGENT_LABELS=agent:daedalus,agent:any
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

## Scheduler Shape

Use a systemd timer to invoke the CLI. The installed schedule is intentionally single-worker: the service is `Type=oneshot`, stays active for the full attached Codex run, has no normal runtime timeout, and the timer uses `OnUnitInactiveSec=5min` so the next scan is scheduled only after the previous service invocation exits.

The local lock prevents multiple scheduled invocations on the same host from claiming multiple issues at once. Local busy state is an additional guard for manual runs; if the agent is already working, the CLI exits early with a clear busy message rather than claiming more work.

Example service:

```ini
[Unit]
Description=Codex Linear Work Delegator

[Service]
Type=oneshot
WorkingDirectory=/home/daedalus/github/TheWorstProgrammerEver/Codex-Linear-Work-Delegator
EnvironmentFile=/home/daedalus/.config/codex-linear-work-delegator/env
ExecStart=/usr/bin/npm start -- --env-file /home/daedalus/.config/codex-linear-work-delegator/env
TimeoutStartSec=infinity
KillMode=control-group
User=daedalus
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

The startup health check treats `agent:daedalus` as directly relevant to Daedalus. For `agent:any`, it checks the latest claim comment and only warns if that comment says this agent claimed the issue. It does not mark issues failed, kill processes, or infer failure from age alone.

Codex is instructed to update Linear when complete or blocked:

- move to `In Review` with a summary when complete;
- move to `Blocked` with blocker notes when blocked.

For PR-producing work, the spawned prompt directs workers to `$HOME/codex-notes/runbooks/github-app-pr-workflow.md` when present and names the preferred GitHub App helper path: `codex-github-token --expires-at`, `codex-gh` for GitHub API/PR state, and `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=$HOME/.local/bin/codex-github-askpass git push ...` for authenticated HTTPS Git operations. If a push returns `403`, workers should verify token minting, installation repository access, askpass configuration, and a dry-run push before concluding that repository access is absent.

## Notes

- The Linear poller uses the Linear GraphQL API directly.
- Codex MCP OAuth remains useful for interactive sessions and for the spawned Codex worker.
- The scheduler should use a dedicated, revocable Linear API key.
- `LINEAR_API_KEY` is required even for `--dry-run`, because dry-run still performs the real Linear lookup and only skips claiming/spawning.
