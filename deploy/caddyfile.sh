#!/usr/bin/env bash
# Собрать конфигурацию Caddy: основной домен из шаблона + вторые домены (ALIASES в /etc/ando/deploy.conf),
# которые переадресуют на основной с сохранением адреса страницы.
#   bash caddyfile.sh <куда записать>
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=/dev/null
. "${ANDO_CONF:-/etc/ando/deploy.conf}"   # DOMAIN, ALIASES
OUT=$1
sed "s/__DOMAIN__/$DOMAIN/g" "$DIR/Caddyfile.tmpl" > "$OUT"
for alias in ${ALIASES:-}; do
  [[ "$alias" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ || "$alias" =~ ^xn--[a-z0-9.-]+$ ]] || continue
  [ "$alias" = "$DOMAIN" ] && continue
  cat >> "$OUT" <<EOF

# Второй домен: всё ведёт на $DOMAIN с тем же адресом страницы.
$alias, www.$alias {
	redir https://$DOMAIN{uri} 301
}
EOF
done
