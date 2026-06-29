#!/usr/bin/env bash
set -euo pipefail

unit_base="${UNIT_BASE:-codex-linear-work-delegator}"
systemd_dir="${SYSTEMD_DIR:-/etc/systemd/system}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
service_unit="${unit_base}.service"
timer_unit="${unit_base}.timer"
service_path="${systemd_dir}/${service_unit}"
timer_path="${systemd_dir}/${timer_unit}"

if [[ "$systemd_dir" == "/etc/systemd/system" && "$(id -u)" -ne 0 ]]; then
  printf 'Run this script as root when uninstalling from %s\n' "$systemd_dir" >&2
  exit 1
fi

"$systemctl_bin" disable --now "$timer_unit" >/dev/null 2>&1 || true
"$systemctl_bin" stop "$service_unit" >/dev/null 2>&1 || true

rm -f "$service_path" "$timer_path"

"$systemctl_bin" daemon-reload
"$systemctl_bin" reset-failed "$service_unit" "$timer_unit" >/dev/null 2>&1 || true

printf 'Removed %s and %s\n' "$service_path" "$timer_path"
printf 'Timer disabled: %s\n' "$timer_unit"
