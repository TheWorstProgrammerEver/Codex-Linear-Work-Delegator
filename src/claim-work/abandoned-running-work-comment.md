{{ healthWarningMarker }} {{ identifier }} is still in {{ runningStatus }} for agent {{ agentId }}, but this host has no active local worker state/process for it.

Please review whether the prior Codex run completed, has an active durable local job, or needs manual recovery. Check any issue comments, state files, service/timer units, detached sessions, partial artifacts, and logs before changing status.

If a durable job is still running or resumable, leave the issue in {{ runningStatus }} and add a lightweight status comment with the current state and next resume/reconcile command. If the local artifact exists and validates, finish the Linear completion path. If the artifact is partial after network loss or another external failure, resume it or move the issue to {{ blockedStatus }} with the concrete recovery blocker.

I am not changing status, killing processes, or assuming failure.

{{ signoff }}.
