#!/usr/bin/env bash
# Обновление ANDO AUTO из GitHub. Запускается таймером каждые 5 минут (ando-update.timer)
# и вручную: sudo /opt/ando/deploy/update.sh
# Код лежит в /opt/ando, данные (каталог, фото, заявки, ролики) — в /var/lib/ando, их обновление не трогает.
set -euo pipefail

CONF=/etc/ando/deploy.conf
APP_DIR=/opt/ando
# shellcheck source=/dev/null
. "$CONF"   # REPO_URL, BRANCH, DOMAIN

cd "$APP_DIR"
old=$(git rev-parse HEAD)
git fetch -q --depth 1 origin "$BRANCH"
new=$(git rev-parse FETCH_HEAD)
if [ "$old" = "$new" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi
git reset -q --hard FETCH_HEAD

# Конфигурация Caddy — из шаблона в репозитории; перезагружаем, только если она изменилась.
tmp=$(mktemp)
bash "$APP_DIR/deploy/caddyfile.sh" "$tmp"
if ! cmp -s "$tmp" /etc/caddy/Caddyfile; then
  if caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
    install -m 644 "$tmp" /etc/caddy/Caddyfile
    systemctl reload caddy
  else
    echo "Новая конфигурация Caddy с ошибкой — оставляю старую" >&2
  fi
fi
rm -f "$tmp"

# Юниты systemd тоже из репозитория.
changed=0
for unit in ando.service ando-update.service ando-update.timer; do
  if ! cmp -s "$APP_DIR/deploy/$unit" "/etc/systemd/system/$unit"; then
    install -m 644 "$APP_DIR/deploy/$unit" "/etc/systemd/system/$unit"
    changed=1
  fi
done
[ "$changed" = 1 ] && systemctl daemon-reload

systemctl restart ando
echo "Обновлено: ${old:0:7} → ${new:0:7}"
