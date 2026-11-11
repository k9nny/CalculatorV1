#!/usr/bin/env bash
# Посредник для Telegram Bot API на сервере за границей — когда основной сервер в России не видит api.telegram.org.
# Запускать на ЗАРУБЕЖНОМ сервере (Ubuntu 22.04/24.04):
#   curl -fsSL raw.githubusercontent.com/k9nny/CalculatorV1/gh-pages/r -o r && bash r
# Пропускает только запросы бота (/bot…, /file/bot…) и только с IP основного сервера, остальным отвечает 404.
# На основном сервере потом: TELEGRAM_API_BASE=https://<адрес посредника> в /etc/ando/ando.env и restart.
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "Запустите от root: sudo bash r"

read -r -p "Адрес посредника (Enter — tg.andoavto.ru): " HOST </dev/tty
HOST=${HOST:-tg.andoavto.ru}
read -r -p "IP основного сервера в России (Enter — 168.113.191.212): " MAIN_IP </dev/tty
MAIN_IP=${MAIN_IP:-168.113.191.212}
[[ "$MAIN_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail "IP «$MAIN_IP» не похож на IPv4"

say "Проверяю, что отсюда виден Telegram…"
curl -sS -m 15 -o /dev/null https://api.telegram.org || fail "Этот сервер тоже не видит Telegram — нужен сервер в другой стране."

say "Ставлю Caddy…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null
if ! apt-get install -y -q caddy >/dev/null 2>&1; then
  apt-get install -y -q curl gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q >/dev/null && apt-get install -y -q caddy >/dev/null
fi

cat > /etc/caddy/Caddyfile <<EOF
# Посредник Telegram Bot API для ANDO AUTO. Создано deploy/tg-relay.sh.
$HOST {
	@bot {
		path /bot* /file/bot*
		remote_ip $MAIN_IP
	}
	handle @bot {
		reverse_proxy https://api.telegram.org {
			header_up Host {upstream_hostport}
		}
	}
	handle {
		respond 404
	}
	log {
		output discard
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail "Ошибка в настройке Caddy"
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; fi
systemctl enable -q --now caddy
systemctl reload caddy || systemctl restart caddy

ip=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
say "Готово. Осталось два шага."
cat <<EOF

1. У регистратора домена добавьте A-запись:  ${HOST%%.*}  →  $ip
   (через 5–30 минут посредник получит HTTPS-сертификат сам)

2. На ОСНОВНОМ сервере выполните:
   echo 'TELEGRAM_API_BASE=https://$HOST' >> /etc/ando/ando.env && systemctl restart ando
EOF
