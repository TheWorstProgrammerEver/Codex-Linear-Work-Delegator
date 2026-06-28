# Codex Linear Work Delegator

Local CLI for a Raspberry Pi Codex worker. It polls Linear with a normal API key, claims one eligible issue, and only then starts `codex exec`. The idle polling path uses no LLM/model tokens.

This is intentionally not Codex Cloud Tasks. Linear is the backlog and discussion surface; the Pi is the durable execution platform.

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
- Optional later: `agent:sandbox:workspace-write` or `agent:sandbox:danger-full-access`.

An issue is eligible when:

- its status matches `CODEX_LINEAR_READY_STATUS`;
- it has one of `CODEX_LINEAR_AGENT_LABELS`;
- it is not already marked busy in local worker state.

Linear may display/create this as a label group named `agent` with child labels such as `daedalus` or `any`. The CLI supports both forms: exact flat labels like `daedalus`, and grouped labels configured as `agent:daedalus`.

The CLI chooses the highest priority issue first, then oldest created issue.

## Good Issue Shape

Put the work in the Linear issue itself:

- repo and local path;
- exact task;
- acceptance criteria;
- verification command;
- constraints and non-goals;
- expected output, such as local change, commit, PR, or notes only.

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
codex-linear-work-delegator --wait-timeout-seconds 60
codex-linear-work-delegator --env-file /etc/codex-linear-work-delegator.env
codex-linear-work-delegator --dry-run
codex-linear-work-delegator --no-spawn
```

The wait timeout controls how long this wrapper waits for the spawned Codex child before returning. It does not kill the child. The child PID stays in local state so the next scheduled run can see that work is still active.

## Scheduler Shape

Use a systemd timer or cron to invoke the CLI. The CLI holds a local global lock only during the short claim cycle, then releases it before running Codex.

The local lock prevents multiple scheduled invocations on the same host from claiming multiple issues at once. Local busy state prevents the scheduler from starting another Codex child while one is already running.

Example service:

```ini
[Unit]
Description=Codex Linear Work Delegator

[Service]
Type=oneshot
WorkingDirectory=/home/daedalus/github/TheWorstProgrammerEver/Codex-Linear-Work-Delegator
EnvironmentFile=/home/daedalus/.config/codex-linear-work-delegator/env
ExecStart=/usr/bin/npm start -- --wait-timeout-seconds 60
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

## Claim Behavior

When an issue is claimed, the CLI:

1. moves it to `Agent In Progress`;
2. adds a concise claim comment;
3. fetches a claim-time issue snapshot including description, labels, status, team, assignee, project, cycle, and recent comments;
4. writes local state under `CODEX_LINEAR_STATE_DIR`;
5. spawns `codex exec` for the issue with that snapshot in the prompt.

Codex is instructed to update Linear when complete or blocked:

- move to `In Review` with a summary when complete;
- move to `Blocked` with blocker notes when blocked.

## Notes

- The Linear poller uses the Linear GraphQL API directly.
- Codex MCP OAuth remains useful for interactive sessions and for the spawned Codex worker.
- The scheduler should use a dedicated, revocable Linear API key.
- `LINEAR_API_KEY` is required even for `--dry-run`, because dry-run still performs the real Linear lookup and only skips claiming/spawning.
