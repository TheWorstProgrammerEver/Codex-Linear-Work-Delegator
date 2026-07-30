#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

mode="${1:-}"
case "$mode" in
  dry-run|consume) ;;
  *)
    printf 'Usage: sudo scripts/install.sh dry-run|consume\n' >&2
    exit 64
    ;;
esac

if ((EUID != 0)); then
  printf 'Run this installer through sudo after building and reviewing the source checkout.\n' >&2
  exit 77
fi

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(dirname -- "$script_dir")"
cli="$source_dir/dist/src/cli.js"
policy="$source_dir/config/policy.default.json"

if [[ ! -f "$cli" || ! -f "$policy" ]]; then
  printf 'Missing built CLI or policy; run npm ci && npm run check first.\n' >&2
  exit 66
fi

policy_digest="$(sha256sum -- "$policy" | awk '{print $1}')"
compiled_digest="$(node "$cli" policy-digest)"
if [[ "$policy_digest" != "$compiled_digest" ]]; then
  printf 'Policy digest does not match the reviewed compiled policy.\n' >&2
  exit 78
fi

commit="$(git -C "$source_dir" rev-parse --verify HEAD)"
if [[ -n "$(git -C "$source_dir" status --short)" ]]; then
  printf 'Refusing installation from a dirty source checkout.\n' >&2
  exit 78
fi

install_root="/opt/codex-usage-reset-steward"
release="$install_root/releases/$commit"
if [[ ! -e "$release" ]]; then
  staging="$install_root/releases/.staging-$commit"
  if [[ -e "$staging" ]]; then
    printf 'Staging path already exists; inspect it before retrying.\n' >&2
    exit 73
  fi
  install -d -m 0755 -- "$install_root/releases" "$staging/dist"
  cp -a -- "$source_dir/dist/src" "$staging/dist/src"
  find "$staging" -type d -exec chmod 0755 {} +
  find "$staging" -type f -exec chmod 0644 {} +
  chmod 0755 "$staging/dist/src/cli.js"
  mv -- "$staging" "$release"
fi

next_link="$install_root/.current-$commit"
ln -s -- "$release" "$next_link"
mv -Tf -- "$next_link" "$install_root/current"

install -d -m 0755 -- /etc/codex-usage-reset-steward
install -m 0644 -- "$policy" /etc/codex-usage-reset-steward/policy.json
environment_file="$(mktemp /etc/codex-usage-reset-steward/.steward.env.XXXXXX)"
chmod 0600 "$environment_file"
{
  printf 'CODEX_RESET_STEWARD_MODE=%s\n' "$mode"
  printf 'CODEX_RESET_STEWARD_OWNER=daedalus\n'
  printf 'CODEX_RESET_STEWARD_APPROVED_POLICY_SHA256=%s\n' "$policy_digest"
  printf 'CODEX_RESET_STEWARD_POLICY=/etc/codex-usage-reset-steward/policy.json\n'
  printf 'CODEX_RESET_STEWARD_STATE_DIR=/var/lib/codex-usage-reset-steward\n'
  printf 'CODEX_RESET_STEWARD_AUDIT_FILE=/var/log/codex-usage-reset-steward/audit.jsonl\n'
  printf 'CODEX_RESET_STEWARD_KILL_SWITCH=/etc/codex-usage-reset-steward/disabled\n'
  printf 'CODEX_RESET_STEWARD_LOCK_FILE=/run/codex-usage-reset-steward/steward.lock\n'
} >"$environment_file"
mv -f -- "$environment_file" /etc/codex-usage-reset-steward/steward.env

install -m 0644 -- \
  "$source_dir/systemd/codex-usage-reset-steward.service" \
  /etc/systemd/system/codex-usage-reset-steward.service
install -m 0644 -- \
  "$source_dir/systemd/codex-usage-reset-steward.timer" \
  /etc/systemd/system/codex-usage-reset-steward.timer
systemd-analyze verify \
  /etc/systemd/system/codex-usage-reset-steward.service \
  /etc/systemd/system/codex-usage-reset-steward.timer
agent_home="$(getent passwd daedalus | cut -d: -f6)"
runuser -u daedalus -- env -i \
  "HOME=$agent_home" \
  "PATH=/usr/local/bin:/usr/bin:/bin" \
  "CODEX_RESET_STEWARD_POLICY=/etc/codex-usage-reset-steward/policy.json" \
  "$install_root/current/dist/src/cli.js" --help >/dev/null
runuser -u daedalus -- env -i \
  "HOME=$agent_home" \
  "PATH=/usr/local/bin:/usr/bin:/bin" \
  "CODEX_RESET_STEWARD_POLICY=/etc/codex-usage-reset-steward/policy.json" \
  "$install_root/current/dist/src/cli.js" synthetic-check
systemctl daemon-reload
systemctl enable --now codex-usage-reset-steward.timer
if [[ "$mode" == "dry-run" ]]; then
  systemctl start codex-usage-reset-steward.service
fi
printf 'Installed commit=%s mode=%s\n' "$commit" "$mode"
