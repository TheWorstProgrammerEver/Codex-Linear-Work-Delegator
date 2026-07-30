{{ healthWarningMarker }} {{ identifier }} is still in {{ runningStatus }} for reviewer {{ agentId }}, but this host has no active local review state/process for it.

Bounded local recovery evidence: {{ recoverySummary }}. Log content and credential-bearing output are intentionally not copied into this comment.

Please review whether the prior Codex review completed, left local advise-mode output, or needs manual recovery. Check any issue comments, PR reviews, state files, service/timer units, detached sessions, and logs before changing status.

If the review result exists and is valid, finish the Linear review path. If the review needs to be rerun, move the issue back to {{ reviewReadyStatus }}. If the evidence requires implementation changes, preserve the high-level finding and move the issue to {{ reviewReturnStatus }}. If recovery needs outside input or a trusted local/security review path, move the issue to {{ blockedStatus }} with the concrete blocker.

For hosted or otherwise safety-filtered model runs, a safety refusal must not make a defensive finding disappear. Do not repeatedly retry the same detailed adversarial reproduction. Preserve the high-level finding without unnecessary exploit detail, then choose the safest actionable route above. This special refusal path does not restrict trusted local inference or human security review.

I am not changing status, killing processes, or assuming failure.

{{ signoff }}.
