#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
timer_unit="${TIMER_UNIT:-codex-usage-reset-steward.timer}"

"$systemctl_bin" daemon-reload
"$systemctl_bin" enable "$timer_unit"
"$systemctl_bin" restart "$timer_unit"
"$systemctl_bin" reset-failed "$timer_unit" >/dev/null 2>&1 || true
