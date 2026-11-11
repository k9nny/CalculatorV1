#!/usr/bin/env bash
# Связь сервера с Telegram через бесплатного посредника на Cloudflare (deploy/cf-worker.js).
#   curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/t -o t && bash t
# Проверка, видит ли сервер Cloudflare (до создания посредника):  bash t --check
set -euo pipefail

ENV_FILE=/etc/ando/ando.env
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash t"

code() { curl -sS -m 15 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

if [ "${1:-}" = --check ]; then
  say "Проверяю связь сервера"
  printf 'Telegram напрямую:   %s\n' "$(code https://api.telegram.org)"
  printf 'Cloudflare Workers:  %s\n' "$(code https://workers.cloudflare.com)"
  printf 'Google (для сравнения): %s\n' "$(code https://www.google.com)"
  echo
  echo "Число 200, 301, 302 или 404 — связь есть. 000 — связи нет."
  exit 0
fi

[ -f "$ENV_FILE" ] || fail "Сервер ANDO AUTO не установлен."

say "Адрес посредника"
echo "Его показывает Cloudflare после Deploy, вида https://ando-tg.ИМЯ.workers.dev"
while :; do
  read -r -p "Адрес: " URL </dev/tty
  URL=$(printf '%s' "$URL" | tr -d '[:space:]' | sed -E 's#/+$##')
  [[ "$URL" =~ ^https?:// ]] || URL="https://$URL"
  [[ "$URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "Нужен адрес вида https://ando-tg.name.workers.dev"; continue; }
  # Пробный запрос с несуществующим токеном: если посредник работает, Telegram ответит {"ok":false…}.
  ANS=$(curl -sS -m 20 "$URL/bot1:check/getMe" 2>&1 || true)
  if printf '%s' "$ANS" | grep -q '"ok":false'; then echo "Посредник работает: Telegram отвечает."; break; fi
  echo "Через этот адрес Telegram не отвечает:"
  printf '%s\n' "$ANS" | head -n2 | sed 's/^/  /'
  echo "Проверьте адрес и что в Cloudflare нажали Deploy. Попробуйте ещё раз."
done

if grep -q '^TELEGRAM_API_BASE=' "$ENV_FILE"; then
  sed -i "s#^TELEGRAM_API_BASE=.*#TELEGRAM_API_BASE=$URL#" "$ENV_FILE"
else
  printf 'TELEGRAM_API_BASE=%s\n' "$URL" >> "$ENV_FILE"
fi

TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_FILE" | tail -n1)
if [ -z "$TOKEN" ]; then
  say "Токен бота ещё не записан — подключаем бота."
  curl -fsSL https://raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/b -o /root/b
  exec bash /root/b
fi
ME=$(curl -sS -m 20 "$URL/bot$TOKEN/getMe" 2>/dev/null || true)
unset TOKEN
printf '%s' "$ME" | grep -q '"ok":true' || fail "Telegram не принял токен бота. Подключите бота заново: bash b"
BOT=$(printf '%s' "$ME" | sed -nE 's/.*"username":"([^"]+)".*/\1/p' | head -n1)

systemctl restart ando
sleep 5
if journalctl -u ando -n 30 --no-pager | grep -q "Бот объявлений запущен"; then
  say "ГОТОВО. Бот @$BOT работает через посредника."
  echo "Перешлите боту пост с машиной (фото + описание) — он покажет превью и кнопку «Опубликовать»."
else
  journalctl -u ando -n 15 --no-pager | grep -v -i token || true
  fail "Бот не запустился. Пришлите скриншот этого экрана."
fi
