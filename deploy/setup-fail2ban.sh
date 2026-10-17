#!/usr/bin/env bash
# fail2ban для SSH: 5 неудачных попыток за 10 минут — бан на 1 час, повторно — дольше.
# Вход по ключу (в том числе выкладка из GitHub Actions) не считается неудачей.
set -euo pipefail
JAIL=/etc/fail2ban/jail.d/ogma-sshd.local

if ! command -v fail2ban-client >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -yq fail2ban python3-systemd >/dev/null
fi

want="$(cat <<'EOF'
# Управляется /opt/finance/deploy/setup-fail2ban.sh
[DEFAULT]
backend = systemd
banaction = nftables-multiport
banaction_allports = nftables-allports
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
EOF
)"

if [[ -f "$JAIL" ]] && [[ "$(cat "$JAIL")" == "$want" ]] && systemctl is-active --quiet fail2ban; then
  echo "fail2ban: без изменений"; exit 0
fi

printf '%s\n' "$want" > "$JAIL.new"
chmod 644 "$JAIL.new"
mv "$JAIL.new" "$JAIL"
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban

for i in $(seq 1 10); do
  if fail2ban-client status sshd >/dev/null 2>&1; then
    echo "fail2ban: защита SSH включена"; exit 0
  fi
  sleep 1
done
echo "fail2ban: не запустился, отключаю правило" >&2
journalctl -u fail2ban --no-pager -n 20 >&2 || true
rm -f "$JAIL"
systemctl restart fail2ban || true
exit 0
