#!/usr/bin/env bash
# Ключи развёртывания GitHub на сервере:
#   deploy/deploy-keys.pub      — ключи, которые должны быть в /root/.ssh/authorized_keys;
#   deploy/deploy-keys-revoked  — ключи (вторая часть строки, base64), которые нужно удалить.
# Остальные строки authorized_keys (например, ключ поддержки хостинга) не трогаются.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
AK=/root/.ssh/authorized_keys
install -d -m 700 /root/.ssh
touch "$AK"; chmod 600 "$AK"
while read -r type body comment; do
  [[ -n "${body:-}" ]] || continue
  grep -qF "$body" "$AK" || { echo "$type $body $comment" >> "$AK"; echo "deploy key added: $comment"; }
done < "$DIR/deploy-keys.pub"
if [[ -s "$DIR/deploy-keys-revoked" ]]; then
  tmp="$(mktemp)"; cp "$AK" "$tmp"
  while read -r body; do
    [[ -n "$body" ]] || continue
    # Никогда не удаляем ключ, который сейчас числится в deploy-keys.pub.
    grep -qF "$body" "$DIR/deploy-keys.pub" && continue
    grep -vF "$body" "$tmp" > "$tmp.new" || true; mv "$tmp.new" "$tmp"
  done < "$DIR/deploy-keys-revoked"
  if ! cmp -s "$tmp" "$AK"; then cat "$tmp" > "$AK"; echo "revoked deploy keys removed"; fi
  rm -f "$tmp"
fi
echo "authorized_keys: $(awk '{print $NF}' "$AK" | tr '\n' ' ')"
