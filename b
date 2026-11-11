#!/usr/bin/env bash
# Подключить Telegram-бота к уже установленному серверу ANDO AUTO:
#   curl -fsSL k9nny.github.io/CalculatorV1/b -o b && bash b
# Спрашивает токен и id, проверяет токен у Telegram, вписывает в /etc/ando/ando.env и перезапускает.
set -euo pipefail

ENV_FILE=/etc/ando/ando.env
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash b"
if [ ! -f "$ENV_FILE" ]; then
  say "Сервер ещё не установлен — сначала установка (3–5 минут)."
  curl -fsSL https://k9nny.github.io/CalculatorV1/i -o /root/i
  bash /root/i
  [ -f "$ENV_FILE" ] || fail "Установка не закончилась. Пришлите скриншот экрана."
fi

say "Подключаем бота"
TOKEN=''
while :; do
  read -r -s -p "Вставьте токен бота от @BotFather (символы не видны) и нажмите Enter: " TOKEN </dev/tty; echo >/dev/tty
  TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  if ! [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then echo "Это не похоже на токен. Он выглядит так: 123456789:AAH…"; continue; fi
  ME=$(curl -fsS --max-time 15 "https://api.telegram.org/bot$TOKEN/getMe" 2>/dev/null || true)
  if printf '%s' "$ME" | grep -q '"ok":true'; then
    BOT=$(printf '%s' "$ME" | sed -E 's/.*"username":"([^"]+)".*/\1/')
    echo "Токен подходит: бот @$BOT"
    break
  fi
  echo "Telegram не принял этот токен. Скопируйте его из @BotFather ещё раз (/mybots → бот → API Token)."
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
if journalctl -u ando -n 30 --no-pager | grep -q "Бот объявлений запущен"; then
  say "ГОТОВО. Бот @$BOT запущен."
  echo "Напишите ему в Telegram /list — он пришлёт список машин."
else
  journalctl -u ando -n 15 --no-pager | grep -v -i token || true
  fail "Бот не запустился. Пришлите скриншот этого экрана."
fi
