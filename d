#!/usr/bin/env bash
# Домены сайта.
#   bash domain.sh          — подключить второй домен: он будет вести на основной (с тем же адресом страницы)
#   bash domain.sh --main   — сделать другой домен основным; прежний основной будет вести на него
# Перед запуском у регистратора домена: A-записи @ и www → IP этого сервера.
set -euo pipefail

CONF=/etc/ando/deploy.conf
ENV_FILE=/etc/ando/ando.env
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
MAIN=''
[ "${1:-}" = --main ] && MAIN=1

if [ -n "$MAIN" ]; then
  read -r -p "Новый основной домен (Enter — andoauto.ru): " NEW </dev/tty
else
  read -r -p "Второй домен (Enter — andoauto.ru): " NEW </dev/tty
fi
NEW=$(printf '%s' "${NEW:-andoauto.ru}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^www\.##; s#/.*$##')
[[ "$NEW" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "«$NEW» не похоже на домен"
[ "$NEW" != "$DOMAIN" ] || fail "$NEW уже основной домен — ничего менять не нужно."

ip=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
dns_ok=1
for host in "$NEW" "www.$NEW"; do
  got=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)
  if [ "$got" = "$ip" ]; then echo "$host → $ip — верно"
  else echo "ВНИМАНИЕ: $host → ${got:-не найден}, а нужно $ip."; dns_ok=''
  fi
done

if [ -n "$MAIN" ]; then
  # Если новый домен ещё не ведёт сюда, переключение уронит сайт: старый адрес начнёт отправлять в никуда.
  [ -n "$dns_ok" ] || fail "Сначала у регистратора $NEW: A-записи @ и www → $ip. Когда заработают (обычно 15–30 минут), запустите ещё раз. Сайт пока работает по-старому."
  OLD=$DOMAIN
  LIST=$(printf '%s\n' ${ALIASES:-} "$OLD" | awk -v n="$NEW" 'NF && $0 != n && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')
  sed -i "s/^DOMAIN=.*/DOMAIN=$NEW/" "$CONF"
  DOMAIN=$NEW
else
  LIST=$(printf '%s\n' ${ALIASES:-} "$NEW" | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')
fi
if grep -q '^ALIASES=' "$CONF"; then sed -i "s/^ALIASES=.*/ALIASES=\"$LIST\"/" "$CONF"
else printf 'ALIASES="%s"\n' "$LIST" >> "$CONF"; fi

# Откуда принимать заявки: все домены сайта.
if [ -f "$ENV_FILE" ]; then
  ORIGINS=$(for d in "$DOMAIN" $LIST; do printf 'https://%s,https://www.%s,https://app.%s,' "$d" "$d" "$d"; done | sed 's/,$//')
  if grep -q '^ALLOWED_ORIGINS=' "$ENV_FILE"; then sed -i "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=$ORIGINS#" "$ENV_FILE"
  else printf 'ALLOWED_ORIGINS=%s\n' "$ORIGINS" >> "$ENV_FILE"; fi
fi

tmp=$(mktemp)
bash "$APP_DIR/deploy/caddyfile.sh" "$tmp"
caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1 || { rm -f "$tmp"; fail "Ошибка в настройке Caddy. Пришлите скриншот экрана."; }
install -m 644 "$tmp" /etc/caddy/Caddyfile && rm -f "$tmp"
systemctl reload caddy || systemctl restart caddy
systemctl restart ando 2>/dev/null || true

say "Готово."
if [ -n "$MAIN" ]; then
  cat <<EOF
Основной адрес сайта теперь https://$DOMAIN
$OLD ведёт на него с тем же адресом страницы. Приложение в Telegram и админка по старым ссылкам продолжают работать.
Сертификат HTTPS для $DOMAIN сервер получит сам за пару минут.
EOF
else
  cat <<EOF
Сайт открывается по https://$DOMAIN
$NEW и www.$NEW ведут туда же. Сертификат HTTPS для $NEW сервер получит сам, когда A-записи заработают
(обычно 5–30 минут, иногда до нескольких часов). Запускать ещё раз не нужно.
EOF
fi
