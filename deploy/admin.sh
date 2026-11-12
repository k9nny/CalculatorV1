#!/usr/bin/env bash
# Админка на сайте: задать пароль и получить секретную ссылку.
#   curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/a -o a && bash a
# Новая ссылка, если старая попала в чужие руки (все входы сбросятся):  bash a --new-link
# Показать ссылку ещё раз:                                              bash a --show
# Ссылка хранится только на этом сервере, в /var/lib/ando/private/admin.json.
set -euo pipefail

ENV_FILE=/etc/ando/ando.env
CONF=/etc/ando/deploy.conf
CLI=/opt/ando/ando-app/server/admin-cli.js
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash a"
[ -f "$ENV_FILE" ] && [ -f "$CONF" ] || fail "Сервер ANDO AUTO не установлен. Сначала: curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/i -o i && bash i"
if [ ! -f "$CLI" ]; then
  say "Обновляю код сервера…"
  bash /opt/ando/deploy/update.sh --force >/dev/null || true
  [ -f "$CLI" ] || fail "Не получилось обновить код. Пришлите скриншот экрана."
fi

DOMAIN=$(sed -n 's/^DOMAIN=//p' "$CONF" | tail -n1)
LEADS_LOG=$(sed -n 's/^LEADS_LOG=//p' "$ENV_FILE" | tail -n1)
LEADS_LOG=${LEADS_LOG:-/var/lib/ando/private/leads.jsonl}
STATE="$(dirname "$LEADS_LOG")/admin.json"
run() { LEADS_LOG="$LEADS_LOG" node "$CLI" "$@"; }

case "${1:-}" in
  --show)     OUT=$(run --show) || exit 1 ;;
  --new-link) OUT=$(run --new-link) || exit 1 ;;
  *)
    say "Пароль для входа в админку"
    echo "Не короче 10 символов. Не используйте пароль от почты или сервера. Символы при вводе не видны."
    while :; do
      read -r -s -p "Пароль: " P1 </dev/tty; echo >/dev/tty
      read -r -s -p "Ещё раз: " P2 </dev/tty; echo >/dev/tty
      if [ "$P1" != "$P2" ]; then echo "Пароли не совпали, ещё раз."; continue; fi
      if [ "${#P1}" -lt 10 ]; then echo "Слишком короткий: нужно хотя бы 10 символов."; continue; fi
      break
    done
    OUT=$(printf '%s\n' "$P1" | run) || exit 1
    unset P1 P2 ;;
esac

chown ando:ando "$STATE" 2>/dev/null || true
chmod 600 "$STATE" 2>/dev/null || true
SLUG=$(printf '%s' "$OUT" | sed -n 's/^SLUG=//p')
[ -n "$SLUG" ] || fail "Что-то пошло не так. Пришлите скриншот экрана."

URL="https://$DOMAIN/app/$SLUG/"
# QR-код, чтобы не перепечатывать ссылку: навести камеру телефона на экран.
command -v qrencode >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q qrencode >/dev/null 2>&1 || true
clear 2>/dev/null || true
echo "Админка готова. Ссылку никому не пересылайте: без неё админку не найти."
echo "Показать ещё раз: ando → 6.  Новая ссылка, если старая утекла: bash /opt/ando/deploy/admin.sh --new-link"
echo
echo "    $URL"
if command -v qrencode >/dev/null; then
  qrencode -t ANSI -m 2 "$URL"
  echo "Наведите камеру телефона на QR-код — откроется админка. Сохраните её в закладки."
fi
