#!/usr/bin/env bash
# Подключить Telegram-бота к уже установленному серверу ANDO AUTO:
#   curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/b -o b && bash b
# Спрашивает токен и id, проверяет токен у Telegram, вписывает в /etc/ando/ando.env и перезапускает.
set -euo pipefail

ENV_FILE=/etc/ando/ando.env
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash b"
if [ ! -f "$ENV_FILE" ]; then
  say "Сервер ещё не установлен — сначала установка (3–5 минут)."
  curl -fsSL https://raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/i -o /root/i
  bash /root/i
  [ -f "$ENV_FILE" ] || fail "Установка не закончилась. Пришлите скриншот экрана."
fi

# Если Telegram доступен только через посредника (deploy/tg-relay.sh), берём его адрес из настроек.
API=$(sed -n 's/^TELEGRAM_API_BASE=//p' "$ENV_FILE" | tail -n1)
API=${API:-https://api.telegram.org}

say "Подключаем бота"
TOKEN=''
NOCHECK=''
while :; do
  read -r -s -p "Вставьте токен бота от @BotFather (символы не видны) и нажмите Enter: " TOKEN </dev/tty; echo >/dev/tty
  TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  if ! [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then echo "Это не похоже на токен. Он выглядит так: 123456789:AAH…"; continue; fi
  ME=$(curl -sS --max-time 20 -w '\n%{http_code}' "$API/bot$TOKEN/getMe" 2>&1 || true)
  CODE=$(printf '%s' "$ME" | tail -n1)
  if printf '%s' "$ME" | grep -q '"ok":true'; then
    BOT=$(printf '%s' "$ME" | sed -nE 's/.*"username":"([^"]+)".*/\1/p' | head -n1)
    echo "Токен подходит: бот @$BOT"
    break
  fi
  case "$CODE" in
    401|404) echo "Telegram ответил, что такого токена нет. Возьмите его заново: @BotFather → /mybots → бот → API Token." ;;
    *)
      echo "Сервер не может связаться с Telegram (код ответа: ${CODE:-нет}). Токен не проверен."
      printf '%s\n' "$ME" | head -n2 | grep -v -F "$TOKEN" | sed 's/^/  /'
      read -r -p "Записать токен без проверки? Бот заработает, когда связь с Telegram появится [y/n]: " ANS </dev/tty
      if [ "$ANS" = y ] || [ "$ANS" = Y ] || [ "$ANS" = д ]; then BOT=andoavtobot; NOCHECK=1; break; fi ;;
  esac
done

IDS=''
while :; do
  read -r -p "Ваш Telegram id из @userinfobot (несколько — через запятую): " IDS </dev/tty
  IDS=$(printf '%s' "$IDS" | tr -d '[:space:]')
  [[ "$IDS" =~ ^[0-9]{5,15}(,[0-9]{5,15})*$ ]] && break
  echo "Нужно число из @userinfobot, например 123456789."
done

set_var() {  # set_var ИМЯ ЗНАЧЕНИЕ — заменить строку или дописать, если её нет
  if grep -q "^$1=" "$ENV_FILE"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$ENV_FILE" > "$ENV_FILE.new"
    cat "$ENV_FILE.new" > "$ENV_FILE" && rm -f "$ENV_FILE.new"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
set_var TELEGRAM_BOT_TOKEN "$TOKEN"
set_var ADMIN_IDS "$IDS"
set_var MANAGER_CHAT_IDS "$IDS"
set_var APP_LINK "https://t.me/$BOT/cars"
unset TOKEN

systemctl restart ando
sleep 4
if [ -n "${NOCHECK:-}" ]; then
  say "Токен и id записаны, но сервер сейчас не видит Telegram — бот отвечать не будет."
  echo "Пришлите скриншот этого экрана: разберёмся со связью."
  exit 1
fi
if journalctl -u ando -n 30 --no-pager | grep -q "Бот объявлений запущен"; then
  say "ГОТОВО. Бот @$BOT запущен."
  echo "Напишите ему в Telegram /list — он пришлёт список машин."
else
  journalctl -u ando -n 15 --no-pager | grep -v -i token || true
  fail "Бот не запустился. Пришлите скриншот этого экрана."
fi
