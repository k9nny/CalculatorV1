#!/usr/bin/env bash
# Собрать конфигурацию Caddy: основной домен из шаблона + вторые домены (ALIASES в /etc/ando/deploy.conf).
# Второй домен ведёт страницы сайта на основной с тем же адресом, а приложение (/app/), заявки (/api/)
# и app.<домен> обслуживает сам — чтобы старые ссылки на приложение и бота не ломались.
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

# Второй домен: страницы сайта ведут на $DOMAIN, приложение и заявки работают и здесь.
$alias, www.$alias {
	encode zstd gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:8080
	}
	redir /app /app/ 308
	handle_path /app/* {
		reverse_proxy 127.0.0.1:8080
	}
	handle {
		redir https://$DOMAIN{uri} 301
	}
	header -Server
}

app.$alias {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
	header -Server
}
EOF
done
