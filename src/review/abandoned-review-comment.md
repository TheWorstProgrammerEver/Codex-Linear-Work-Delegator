{{ healthWarningMarker }} {{ identifier }} is still in {{ runningStatus }} for reviewer {{ agentId }}, but this host has no active local review state/process for it.

Please review whether the prior Codex review completed, left local advise-mode output, or needs manual recovery. Check any issue comments, PR reviews, state files, service/timer units, detached sessions, and logs before changing status.

If the review result exists and is valid, finish the Linear review path. If the review needs to be rerun, move the issue back to {{ reviewReadyStatus }}. If recovery needs outside input, move the issue to {{ blockedStatus }} with the concrete blocker.

I am not changing status, killing processes, or assuming failure.

{{ signoff }}.
