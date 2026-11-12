#!/usr/bin/env bash
# Подключить нейросеть Kimi для разбора объявлений и фото: ando → 9 (или bash /opt/ando/deploy/llm.sh).
# Спрашивает ключ API (символы не видны), проверяет его, выбирает модель и записывает в /etc/ando/ando.env.
# Выключить: bash llm.sh --off
set -euo pipefail

ENV_FILE=/etc/ando/ando.env
APP=/opt/ando/ando-app
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "Запустите от root"
[ -f "$ENV_FILE" ] || fail "Сервер ANDO AUTO не установлен."

set_var() {  # set_var ИМЯ ЗНАЧЕНИЕ
  if grep -q "^$1=" "$ENV_FILE"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$ENV_FILE" > "$ENV_FILE.new"
    cat "$ENV_FILE.new" > "$ENV_FILE" && rm -f "$ENV_FILE.new"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

if [ "${1:-}" = --off ]; then
  set_var LLM_API_KEY ''
  systemctl restart ando
  say "Нейросеть выключена: объявления разбираются обычным способом."
  exit 0
fi

HDR=$(mktemp); chmod 600 "$HDR"
trap 'rm -f "$HDR" "$HDR.out"' EXIT

say "Ключ API Kimi"
echo "Возьмите его в кабинете platform.moonshot.ai → API Keys. Вставьте правым кликом и нажмите Enter (символы не видны)."
BASE=''
while :; do
  read -r -s -p "Ключ: " KEY </dev/tty; echo >/dev/tty
  KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
  [ -n "$KEY" ] || { echo "Пусто, ещё раз."; continue; }
  printf 'Authorization: Bearer %s\n' "$KEY" > "$HDR"
  any=''
  for b in https://api.moonshot.ai/v1 https://api.moonshot.cn/v1; do
    code=$(curl -sS -m 20 -H @"$HDR" -o "$HDR.out" -w '%{http_code}' "$b/models" 2>/dev/null || true)
    [ "$code" != 000 ] && [ -n "$code" ] && any=1
    if [ "$code" = 200 ]; then BASE=$b; break; fi
  done
  [ -n "$BASE" ] && break
  if [ -z "$any" ]; then fail "Сервер не может связаться с Kimi (api.moonshot.ai). Пришлите скриншот этого экрана."; fi
  echo "Kimi не принял ключ. Проверьте, что скопировали его целиком, и вставьте ещё раз."
done
echo "Ключ подходит ($BASE)."

# Список моделей; по умолчанию — K3.
mapfile -t MODELS < <(node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const ids = (d.data || []).map((m) => m.id).filter(Boolean).sort();
  console.log(ids.join("\n"));' "$HDR.out")
[ "${#MODELS[@]}" -gt 0 ] || fail "Kimi не вернул список моделей. Пришлите скриншот."
DEF=''
for m in "${MODELS[@]}"; do case "${m,,}" in *k3*) if [ -z "$DEF" ] || [ "${#m}" -lt "${#DEF}" ]; then DEF=$m; fi ;; esac; done
[ -n "$DEF" ] || DEF=${MODELS[0]}
say "Модели в вашем аккаунте"
i=1; for m in "${MODELS[@]}"; do printf '  %2d  %s%s\n' "$i" "$m" "$([ "$m" = "$DEF" ] && echo '   ← по умолчанию')"; i=$((i+1)); done
read -r -p "Номер модели (Enter — $DEF): " N </dev/tty
MODEL=$DEF
if [[ "$N" =~ ^[0-9]+$ ]] && [ "$N" -ge 1 ] && [ "$N" -le "${#MODELS[@]}" ]; then MODEL=${MODELS[$((N-1))]}; fi

say "Проверяю разбор на примере…"
export LLM_BASE_URL=$BASE LLM_API_KEY=$KEY LLM_MODEL=$MODEL
TEST=$(cd "$APP" && node -e '
  const { createSmartParser } = require("./server/llm");
  const p = createSmartParser({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL }, { log: (m) => console.error(m) });
  p.ask("Продаю мерс ешку 2017г, 2.0 бенз 184 лс, полный привод, пробег 98т.км, 2 хозяина, цена 2 млн 650, торг").then((r) => {
    console.log(JSON.stringify({ make: r.make, model: r.model, year: r.year, price: r.price, mileage: r.mileage, drive: r.drive }));
  }).catch((e) => { console.log("ERR " + e.message); });' 2>&1 || true)
echo "  $TEST"
case "$TEST" in ERR*|"") fail "Модель $MODEL не ответила. Запустите ещё раз и выберите другую модель.";; esac

# Понимает ли модель фото: короткий пробный запрос с логотипом.
VISION=0
if [ -f /opt/ando/ando-site/assets/logo.png ]; then
  VTEST=$(cd "$APP" && node -e '
    const { createSmartParser } = require("./server/llm");
    let err = "";
    const p = createSmartParser({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL }, { log: (m) => { err = m; } });
    p.photo(require("fs").readFileSync("/opt/ando/ando-site/assets/logo.png"), "image/png").then(() => console.log(err ? "NO" : "YES"));' 2>/dev/null || echo NO)
  [ "$VTEST" = YES ] && VISION=1
fi

set_var LLM_BASE_URL "$BASE"
set_var LLM_API_KEY "$KEY"
set_var LLM_MODEL "$MODEL"
set_var LLM_VISION "$VISION"
unset KEY LLM_API_KEY
systemctl restart ando

say "ГОТОВО. Объявления разбирает $MODEL."
if [ "$VISION" = 1 ]; then echo "Фото: модель видит фото — если в тексте нет марки, модели, кузова или цвета, они определятся по первому фото."
else echo "Фото: эта модель не принимает фото, разбирается только текст."; fi
echo "Выключить нейросеть: bash /opt/ando/deploy/llm.sh --off"
