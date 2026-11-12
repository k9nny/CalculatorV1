#!/usr/bin/env bash
# Установка ANDO AUTO на чистый сервер Ubuntu 24.04 одной командой:
#
#   curl -fsSL https://raw.githubusercontent.com/k9nny/CalculatorV1/claude/eager-gates-snjxp1/deploy/install.sh -o install.sh && sudo bash install.sh
#
# Что ставит: сайт (домен), мини-приложение (app.домен), приём заявок, бота объявлений, ролики,
# HTTPS (Caddy + Let's Encrypt), автозапуск и автообновление из GitHub каждые 5 минут.
# Токены вводятся здесь, на сервере, и хранятся только в /etc/ando/ando.env — никуда не отправляются.
# Повторный запуск безопасен: данные и настройки сохраняются.
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/k9nny/CalculatorV1.git}
BRANCH=${BRANCH:-claude/eager-gates-snjxp1}
APP_DIR=/opt/ando
DATA_DIR=/var/lib/ando
ETC_DIR=/etc/ando
ENV_FILE=$ETC_DIR/ando.env
CONF=$ETC_DIR/deploy.conf

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "запустите от root: sudo bash install.sh"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || [ "${ID:-}" = debian ] || fail "нужен Ubuntu 24.04 (у вас ${PRETTY_NAME:-неизвестная система})"

# Вопрос с ответом из терминала (скрипт может быть запущен через пайп).
ask() {  # ask ПЕРЕМЕННАЯ "Вопрос" [secret]
  local __var=$1 __q=$2 __secret=${3:-} __val=''
  if [ -n "${!__var:-}" ]; then return; fi
  if [ -r /dev/tty ]; then
    if [ -n "$__secret" ]; then read -r -s -p "$__q: " __val </dev/tty; echo >/dev/tty
    else read -r -p "$__q: " __val </dev/tty; fi
  fi
  printf -v "$__var" '%s' "$__val"
}

# ---------- 1. Настройки ----------
if [ -f "$CONF" ]; then
  # shellcheck source=/dev/null
  . "$CONF"
  say "Найдена прошлая установка для $DOMAIN — обновляю, настройки сохраняю."
else
  say "Установка ANDO AUTO"
  echo "Домен должен быть уже куплен. Если чего-то пока нет — оставьте пустым и нажмите Enter,"
  echo "потом впишете в $ENV_FILE и выполните: sudo systemctl restart ando"
  ask DOMAIN "Домен без https и www (Enter — andoavto.ru)"
  DOMAIN=$(printf '%s' "${DOMAIN:-andoavto.ru}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^www\.##; s#/.*$##')
  [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ || "$DOMAIN" =~ ^xn--[a-z0-9.-]+$ ]] || fail "домен «$DOMAIN» не похож на домен"
  ask TELEGRAM_BOT_TOKEN "Токен Telegram-бота от @BotFather (ввод скрыт)" secret
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && ! [[ "$TELEGRAM_BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then
    fail "токен не похож на токен бота (вид: 123456789:AA...)"
  fi
  ask ADMIN_IDS "Telegram id тех, кто добавляет машины, через запятую"
  ask MANAGER_CHAT_IDS "Telegram id, куда присылать заявки, через запятую"
  ask CLIP_TG_CHANNEL "Telegram-канал для роликов (@канал), можно пусто"
fi

# ---------- 2. Пакеты ----------
say "Ставлю пакеты (несколько минут)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg ufw ffmpeg >/dev/null
apt-get install -y -q rhvoice rhvoice-russian >/dev/null 2>&1 || echo "RHVoice не установился — ролики будут ждать живой голос (TTS_URL)"

node_major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
  apt-get install -y -q nodejs >/dev/null 2>&1 || true
  node_major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
  if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -q nodejs >/dev/null
  fi
fi

if ! command -v caddy >/dev/null; then
  if ! apt-get install -y -q caddy >/dev/null 2>&1; then
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q && apt-get install -y -q caddy >/dev/null
  fi
fi

# ---------- 3. Код и данные ----------
say "Скачиваю код из GitHub…"
id ando >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin ando
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chmod +x "$APP_DIR/deploy/"*.sh

mkdir -p "$DATA_DIR/photos" "$DATA_DIR/private/clips" "$DATA_DIR/private/voice"
# Каталог: на первом запуске — демо-объявления из репозитория, дальше его ведёт бот.
[ -f "$DATA_DIR/cars.json" ] || cp "$APP_DIR/ando-app/public/data/cars.json" "$DATA_DIR/cars.json"
chown -R ando:ando "$DATA_DIR"
chmod 750 "$DATA_DIR" "$DATA_DIR/private"

mkdir -p "$ETC_DIR"
if [ ! -f "$CONF" ]; then
  printf 'REPO_URL=%s\nBRANCH=%s\nDOMAIN=%s\n' "$REPO_URL" "$BRANCH" "$DOMAIN" > "$CONF"
fi
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
# Настройки ANDO AUTO. После правки: sudo systemctl restart ando
# Описание всех настроек: /opt/ando/ando-app/.env.example
PORT=8080
HOST=127.0.0.1
TRUST_PROXY=1
ALLOWED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN

CARS_FILE=$DATA_DIR/cars.json
PHOTOS_DIR=$DATA_DIR/photos
LEADS_LOG=$DATA_DIR/private/leads.jsonl
CLIPS_DIR=$DATA_DIR/private/clips

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
ADMIN_IDS=${ADMIN_IDS:-}
MANAGER_CHAT_IDS=${MANAGER_CHAT_IDS:-}
# Ссылка на мини-приложение из @BotFather (https://t.me/бот/приложение)
APP_LINK=
MAX_BOT_TOKEN=

CLIPS=1
CLIP_TIMES=10:40,15:20,19:40
CLIP_TG_CHANNEL=${CLIP_TG_CHANNEL:-}
VK_GROUP_ID=
VK_TOKEN=
PHONE_LABEL=+7 989 085-31-77
# Живой голос Qwen3-TTS, если запущен (см. README): http://127.0.0.1:8765
TTS_URL=
EOF
  umask 022
fi
chown root:ando "$ENV_FILE" && chmod 640 "$ENV_FILE"

# ---------- 4. Службы ----------
say "Настраиваю автозапуск и HTTPS…"
for unit in ando.service ando-update.service ando-update.timer; do
  install -m 644 "$APP_DIR/deploy/$unit" "/etc/systemd/system/$unit"
done
bash "$APP_DIR/deploy/caddyfile.sh" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail "ошибка в конфигурации Caddy"
systemctl daemon-reload
# Короткая команда «ando» — меню настроек.
printf '#!/bin/sh\nexec bash /opt/ando/deploy/ando.sh "$@"\n' > /usr/local/bin/ando && chmod 755 /usr/local/bin/ando
systemctl enable -q --now ando ando-update.timer caddy
systemctl restart ando
systemctl reload caddy || systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ---------- 5. Проверка ----------
ok=''
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || fail "приложение не запустилось. Журнал: journalctl -u ando -n 50"

ip=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
say "Готово. Сервер работает."
cat <<EOF

Осталось у регистратора домена добавить три A-записи на IP этого сервера ($ip):

    @     A   $ip
    www   A   $ip
    app   A   $ip

Через 5–30 минут после этого откроются:
    https://$DOMAIN        — сайт, заявки с формы идут менеджеру в Telegram
    https://app.$DOMAIN    — мини-приложение (этот адрес укажите в @BotFather → /newapp)

Полезное:
    sudo nano $ENV_FILE && sudo systemctl restart ando   — поменять токены и настройки
    journalctl -u ando -f                                 — журнал приложения и бота
    sudo $APP_DIR/deploy/update.sh --force                — обновить прямо сейчас
Код обновляется из GitHub автоматически каждые 5 минут (ветка $BRANCH).
EOF
