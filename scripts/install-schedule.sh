#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="${REPO_DIR:-$(cd -- "$script_dir/.." && pwd)}"
unit_base="${UNIT_BASE:-codex-linear-work-delegator}"
systemd_dir="${SYSTEMD_DIR:-/etc/systemd/system}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
install_bin="${INSTALL_BIN:-install}"
target_user="${TARGET_USER:-${SUDO_USER:-$(id -un)}}"
on_boot_sec="${ON_BOOT_SEC:-2min}"
poll_interval="${POLL_INTERVAL:-5min}"
accuracy_sec="${ACCURACY_SEC:-30s}"

if ! target_home="$(getent passwd "$target_user" | cut -d: -f6)"; then
  printf 'Unable to determine home directory for user: %s\n' "$target_user" >&2
  exit 1
fi

env_file="${ENV_FILE:-$target_home/.config/codex-linear-work-delegator/env}"
npm_bin="${NPM_BIN:-$(command -v npm || true)}"
service_unit="${unit_base}.service"
timer_unit="${unit_base}.timer"
service_path="${systemd_dir}/${service_unit}"
timer_path="${systemd_dir}/${timer_unit}"

if [[ -z "$npm_bin" ]]; then
  printf 'Unable to find npm on PATH. Set NPM_BIN explicitly.\n' >&2
  exit 1
fi

if [[ ! -f "$repo_dir/package.json" ]]; then
  printf 'Repo directory does not look valid: %s\n' "$repo_dir" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  printf 'Expected env file does not exist: %s\n' "$env_file" >&2
  exit 1
fi

if [[ "$systemd_dir" == "/etc/systemd/system" && "$(id -u)" -ne 0 ]]; then
  printf 'Run this script as root when installing into %s\n' "$systemd_dir" >&2
  exit 1
fi

mkdir -p "$systemd_dir"

tmp_service="$(mktemp)"
tmp_timer="$(mktemp)"
cleanup() {
  rm -f "$tmp_service" "$tmp_timer"
}
trap cleanup EXIT

cat >"$tmp_service" <<EOF
[Unit]
Description=Codex Linear Work Delegator
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$target_user
WorkingDirectory=$repo_dir
EnvironmentFile=$env_file
ExecStart=$npm_bin start -- --env-file $env_file
TimeoutStartSec=infinity
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

cat >"$tmp_timer" <<EOF
[Unit]
Description=Poll Linear for local Codex work

[Timer]
OnBootSec=$on_boot_sec
OnUnitInactiveSec=$poll_interval
AccuracySec=$accuracy_sec
Persistent=true
Unit=$service_unit

[Install]
WantedBy=timers.target
EOF

"$install_bin" -D -m 0644 "$tmp_service" "$service_path"
"$install_bin" -D -m 0644 "$tmp_timer" "$timer_path"

"$systemctl_bin" daemon-reload
"$systemctl_bin" enable --now "$timer_unit"
"$systemctl_bin" restart "$timer_unit"
"$systemctl_bin" reset-failed "$service_unit" "$timer_unit" >/dev/null 2>&1 || true

printf 'Installed %s and %s\n' "$service_path" "$timer_path"
printf 'Timer enabled and started: %s\n' "$timer_unit"
printf 'Inspect with: %s status %s && %s list-timers %s\n' "$systemctl_bin" "$timer_unit" "$systemctl_bin" "$timer_unit"
