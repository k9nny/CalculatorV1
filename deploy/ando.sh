#!/usr/bin/env bash
# Короткая команда на сервере: ando — меню настроек ANDO AUTO.
# Ставится в /usr/local/bin/ando при обновлении (deploy/update.sh).
set -euo pipefail
D=/opt/ando/deploy
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }

case "${1:-}" in
  1|admin)  shift || true; exec bash "$D/admin.sh" "$@" ;;
  2|tg)     shift || true; exec bash "$D/tg.sh" "$@" ;;
  3|domain) exec bash "$D/domain.sh" ;;
  8|main)   exec bash "$D/domain.sh" --main ;;
  4|bot)    exec bash "$D/bot.sh" ;;
  5|update) exec bash "$D/update.sh" --force ;;
esac

cat <<'EOF'

ANDO AUTO — что сделать?
  1  Админка: пароль и секретная ссылка
  2  Связь с Telegram через Cloudflare
  3  Подключить второй домен
  4  Подключить бота (токен и id)
  5  Обновить код сейчас
  6  Показать ссылку на админку
  7  Проверить связь с Telegram и Cloudflare
  8  Сделать другой домен основным
EOF
read -r -p "Номер и Enter: " N </dev/tty
case "$N" in
  1) exec bash "$D/admin.sh" ;;
  2) exec bash "$D/tg.sh" ;;
  3) exec bash "$D/domain.sh" ;;
  4) exec bash "$D/bot.sh" ;;
  5) exec bash "$D/update.sh" --force ;;
  6) exec bash "$D/admin.sh" --show ;;
  7) exec bash "$D/tg.sh" --check ;;
  8) exec bash "$D/domain.sh" --main ;;
  *) echo "Нет такого номера." ;;
esac
