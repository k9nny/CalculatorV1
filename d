#!/usr/bin/env bash
# Подключить второй домен: он будет вести на основной сайт (с тем же адресом страницы).
#   curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/d -o d && bash d
# Перед запуском у регистратора второго домена: A-записи @ и www → IP этого сервера.
set -euo pipefail

CONF=/etc/ando/deploy.conf
APP_DIR=/opt/ando
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash d"
[ -f "$CONF" ] || fail "Сервер ANDO AUTO не установлен."
if [ ! -f "$APP_DIR/deploy/caddyfile.sh" ]; then
  say "Обновляю код сервера…"
  bash "$APP_DIR/deploy/update.sh" --force >/dev/null || true
  [ -f "$APP_DIR/deploy/caddyfile.sh" ] || fail "Не получилось обновить код. Пришлите скриншот экрана."
fi
# shellcheck source=/dev/null
. "$CONF"

read -r -p "Второй домен (Enter — andoauto.ru): " NEW </dev/tty
NEW=$(printf '%s' "${NEW:-andoauto.ru}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^www\.##; s#/.*$##')
[[ "$NEW" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "«$NEW» не похоже на домен"
[ "$NEW" != "$DOMAIN" ] || fail "$NEW — это и есть основной домен."

ip=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
for host in "$NEW" "www.$NEW"; do
  got=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)
  if [ "$got" = "$ip" ]; then echo "$host → $ip — верно"
  else echo "ВНИМАНИЕ: $host → ${got:-не найден}, а нужно $ip. Проверьте A-записи у регистратора (обновляются до нескольких часов)."
  fi
done

LIST=$(printf '%s\n' ${ALIASES:-} "$NEW" | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')
if grep -q '^ALIASES=' "$CONF"; then sed -i "s/^ALIASES=.*/ALIASES=\"$LIST\"/" "$CONF"
else printf 'ALIASES="%s"\n' "$LIST" >> "$CONF"; fi

tmp=$(mktemp)
bash "$APP_DIR/deploy/caddyfile.sh" "$tmp"
caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1 || { rm -f "$tmp"; fail "Ошибка в настройке Caddy. Пришлите скриншот экрана."; }
install -m 644 "$tmp" /etc/caddy/Caddyfile && rm -f "$tmp"
systemctl reload caddy || systemctl restart caddy

say "Готово."
cat <<EOF
Сайт открывается по https://$DOMAIN
$NEW и www.$NEW ведут туда же. Сертификат HTTPS для $NEW сервер получит сам, когда A-записи заработают
(обычно 5–30 минут, иногда до нескольких часов). Проверить: откройте http://$NEW в браузере.
EOF
