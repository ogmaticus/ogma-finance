#!/usr/bin/env bash
# Вход по SSH только по ключам. Файл с префиксом 00-, потому что sshd берёт ПЕРВОЕ
# найденное значение, а образ хостинга (cloud-init, 50-cloud-init.conf) включает пароли.
set -euo pipefail
if ! grep -q "^ssh-" /root/.ssh/authorized_keys 2>/dev/null; then
  echo "В /root/.ssh/authorized_keys нет ключей — вход по паролю НЕ отключён." >&2
  exit 0
fi
rm -f /etc/ssh/sshd_config.d/90-finance.conf
cat > /etc/ssh/sshd_config.d/00-ogma-hardening.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
SSH
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "SSH: $(sshd -T | grep -E '^(passwordauthentication|permitrootlogin) ' | tr '\n' ' ')"
