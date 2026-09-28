#!/usr/bin/env python3
"""Кадры для анимации ANDO через Seedream: OpenRouter (по умолчанию) или BytePlus/Volcengine Ark.

Ключ берется из переменной окружения (OPENROUTER_API_KEY или ARK_API_KEY). Если ее нет, заголовок
Authorization не отправляется: так работает облачная среда Claude Code, где ключ добавлен как
API credential и прокси подставляет его сам. В коде и в репозитории ключа быть не должно.

Порядок работы:
  1) python3 seedream_frames.py start --face ref/face1.jpg --face ref/face2.jpg
     Общий план машины, колесо крупно и 4 варианта главного кадра (водитель у открытого окна).
  2) Выберите master-N с самым похожим лицом.
  3) python3 seedream_frames.py finish --master ../assets/raw/master-2.jpg --light
     Стекло закрыто, широкая улыбка, деньги в руке; с --light еще и версии для светлой темы.
  Список моделей картинок OpenRouter: python3 seedream_frames.py models

Только стандартная библиотека Python 3.8+, ничего устанавливать не нужно.
Проверить запросы без отправки: добавьте --dry-run.

Переменные окружения:
  SEEDREAM_PROVIDER   openrouter (по умолчанию) или ark
  SEEDREAM_MODEL      по умолчанию bytedance-seed/seedream-4.5 (OpenRouter) или seedream-4-0-250828 (Ark)
  IMAGE_RESOLUTION    для OpenRouter: 1K, 2K или 4K (по умолчанию 2K)
  OPENROUTER_API_KEY  ключ OpenRouter
  ARK_API_KEY         ключ BytePlus/Volcengine
  ARK_BASE_URL        по умолчанию https://ark.ap-southeast.bytepluses.com/api/v3;
                      для Volcengine https://ark.cn-beijing.volces.com/api/v3 и модель doubao-seedream-4-0-250828
"""
import argparse
import base64
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

PROVIDER = os.environ.get("SEEDREAM_PROVIDER", "openrouter").lower()
if PROVIDER == "ark":
    BASE_URL = os.environ.get("ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3").rstrip("/")
    ENDPOINT = BASE_URL + "/images/generations"
    MODEL = os.environ.get("SEEDREAM_MODEL", "seedream-4-0-250828")
    API_KEY = os.environ.get("ARK_API_KEY", "")
else:
    BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    ENDPOINT = BASE_URL + "/images"
    MODEL = os.environ.get("SEEDREAM_MODEL", "bytedance-seed/seedream-4.5")
    API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
RESOLUTION = os.environ.get("IMAGE_RESOLUTION", "2K")
DEFAULT_OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "raw"

# Кадр: (соотношение сторон для OpenRouter, точный размер для Ark)
SHOT_WIDE = ("16:9", "4096x2304")
SHOT_WHEEL = ("4:3", "2048x1536")
SHOT_WINDOW = ("4:3", "2560x1920")

STUDIO_DARK = (
    "Low-key dark studio: seamless charcoal-black backdrop, softly lit dark floor with a subtle reflection, "
    "large overhead softbox, crisp rim light along the shoulder line and roof."
)
CAR = (
    "a black Mercedes-Benz S-Class sedan (W223), gloss black paint, chrome window trim, "
    "20-inch silver multi-spoke wheels, all badges and emblems removed, no license plate"
)

PROMPT_WIDE = (
    "Photorealistic automotive advertising photo. Exact 90-degree side profile of " + CAR + ", facing right, "
    "whole car in the center of the frame with empty space around it. Driver's window closed, dark tinted glass. "
    + STUDIO_DARK + " Camera at wheel height, 50mm lens, sharp focus, high detail. "
    "No people visible, no text, no watermark."
)
PROMPT_WHEEL = (
    "Photorealistic extreme close-up of the front wheel of the black Mercedes-Benz S-Class from the reference image, "
    "exact side-on view, the wheel centered and filling most of the frame. 20-inch silver multi-spoke rim, "
    "drilled brake disc and caliper visible, black fender arch and a bit of the door around it. "
    "Same dark studio lighting and floor as the reference image, rim light on the fender edge. "
    "Sharp focus, high detail, no badges, no text."
)


def prompt_master(face_refs, car_ref):
    return (
        "Photorealistic automotive advertising photo. Medium close-up from outside the car at window height, "
        "slightly in front of the driver's door, looking into the fully lowered driver's window of the black "
        "Mercedes-Benz S-Class from " + car_ref + ". In the driver's seat sits the man from " + face_refs + ": "
        "exactly the same face, same face shape and nose, same short dark hair with faded sides, "
        "same short full dark beard. He wears rectangular sunglasses with fully opaque solid black lenses, "
        "a grey overshirt over a black t-shirt. He is turned three-quarters toward the camera (half-profile), "
        "relaxed, lips closed, slight confident expression. Chrome window trim, side mirror and part of the "
        "black door in frame, dark leather interior behind him. Low-key dark studio lighting, soft key light on "
        "his face, rim light on the car. 85mm lens, shallow depth of field, sharp focus on the face, natural skin "
        "texture. No badges, no text, no watermark."
    )


PROMPT_CLOSED = (
    "Edit this image: raise the driver's window glass fully closed. Dark tinted glass with a soft studio "
    "reflection, the driver is only faintly visible through the tint. Keep everything else exactly the same: "
    "framing, car, man, lighting, background."
)
PROMPT_SMILE = (
    "Edit this image: the man breaks into a big genuine open-mouth smile showing his upper teeth, cheeks raised, "
    "head turned slightly more toward the camera. Keep his identity, beard, hair, black sunglasses, clothing, "
    "framing, car and lighting exactly the same."
)
PROMPT_MONEY = (
    "Edit this image: keeping the same big smile, the man reaches his left arm out of the open window toward the "
    "camera, holding a neat fan of Russian 5000-ruble banknotes between his thumb and fingers. The hand and "
    "banknotes are closer to the camera and in sharp focus, anatomically correct hand with five fingers. "
    "Keep his face, black sunglasses, clothing, framing, car and lighting exactly the same."
)
PROMPT_LIGHT = (
    "Edit this image: replace the dark studio with a bright white seamless studio, light grey floor with a soft "
    "reflection, soft even daylight lighting. Adjust reflections on the car paint and glass accordingly. "
    "Keep the car, the man, framing and composition exactly the same."
)

MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def data_uri(path):
    path = pathlib.Path(path)
    mime = MIME.get(path.suffix.lower())
    if not mime:
        sys.exit("Неподдерживаемый формат %s: нужен jpg, png или webp" % path)
    return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode("ascii"))


def extension(raw):
    if raw.startswith(b"\x89PNG"):
        return ".png"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    return ".jpg"


def request(url, body=None):
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = "Bearer " + API_KEY
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def build_payload(prompt, shot, refs):
    aspect, size = shot
    if PROVIDER == "ark":
        payload = {"model": MODEL, "prompt": prompt, "size": size, "response_format": "b64_json",
                   "watermark": False, "sequential_image_generation": "disabled"}
        if refs:
            payload["image"] = refs[0] if len(refs) == 1 else refs
    else:
        payload = {"model": MODEL, "prompt": prompt, "aspect_ratio": aspect, "resolution": RESOLUTION}
        if refs:
            payload["input_references"] = [{"type": "image_url", "image_url": {"url": r}} for r in refs]
    return payload


def image_bytes(result):
    """Достает первую картинку из ответа: b64_json или data:/https-ссылка."""
    items = result.get("data") or []
    if not items:
        return None
    item = items[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    url = item.get("url") or ""
    if url.startswith("data:"):
        return base64.b64decode(url.split(",", 1)[1])
    if url.startswith("http"):
        with urllib.request.urlopen(url, timeout=300) as resp:
            return resp.read()
    return None


class Client:
    def __init__(self, out, dry_run):
        self.out = pathlib.Path(out)
        self.dry_run = dry_run
        if not dry_run and not API_KEY:
            print("Ключ в переменных окружения не задан: отправляю без него, его должен подставить прокси среды.")
        self.out.mkdir(parents=True, exist_ok=True)

    def generate(self, name, prompt, shot, images=()):
        """Один запрос, одна картинка. Возвращает путь к сохраненному файлу."""
        if self.dry_run:
            shown = build_payload(prompt, shot, ["<%s>" % pathlib.Path(p).name for p in images])
            print("\n[dry-run] %s -> POST %s\n%s" % (name, ENDPOINT, json.dumps(shown, ensure_ascii=False, indent=2)))
            return self.out / (name + ".jpg")

        payload = build_payload(prompt, shot, [data_uri(p) for p in images])
        print("-> %s ..." % name, flush=True)
        result = None
        for attempt, pause in enumerate((0, 5, 15, 30)):
            if pause:
                print("   повтор через %d с" % pause, flush=True)
                time.sleep(pause)
            try:
                result = request(ENDPOINT, payload)
                break
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")
                if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                    continue
                hint = ""
                if err.code in (401, 403):
                    hint = "\nКлюч не принят. Проверьте ключ в настройках среды (хост %s)." % ENDPOINT.split("/")[2]
                elif err.code == 402:
                    hint = "\nНа балансе не хватает денег."
                sys.exit("Ошибка API %d при генерации %s:\n%s%s" % (err.code, name, detail, hint))
            except urllib.error.URLError as err:
                if attempt < 3:
                    continue
                sys.exit("Нет соединения с %s: %s" % (ENDPOINT, err.reason))

        raw = image_bytes(result)
        if not raw:
            sys.exit("API не вернул картинку для %s:\n%s" % (name, json.dumps(result, ensure_ascii=False)[:2000]))
        path = self.out / (name + extension(raw))
        path.write_bytes(raw)
        print("   сохранено: %s" % path, flush=True)
        return path


def find(out, stem):
    for ext in (".jpg", ".png", ".webp"):
        p = pathlib.Path(out) / (stem + ext)
        if p.exists():
            return p
    return None


def cmd_start(args):
    faces = args.face
    if not 1 <= len(faces) <= 5:
        sys.exit("Нужно от 1 до 5 фото лица: --face путь --face путь")
    for f in faces:
        if not pathlib.Path(f).exists():
            sys.exit("Файл не найден: %s" % f)
    client = Client(args.out, args.dry_run)

    wide = client.generate("wide", PROMPT_WIDE, SHOT_WIDE)
    client.generate("wheel", PROMPT_WHEEL, SHOT_WHEEL, [wide])

    face_refs = " and ".join("image %d" % (i + 1) for i in range(len(faces)))
    car_ref = "image %d" % (len(faces) + 1)
    refs = list(faces) + [wide]
    for n in range(1, args.count + 1):
        client.generate("master-%d" % n, prompt_master(face_refs, car_ref), SHOT_WINDOW, refs)

    print("\nГотово. Выберите master-N с самым похожим лицом и запустите:\n"
          "  python3 seedream_frames.py finish --master %s/master-N.jpg --light" % args.out)


def cmd_finish(args):
    master = pathlib.Path(args.master)
    if not master.exists():
        sys.exit("Файл не найден: %s" % master)
    client = Client(args.out, args.dry_run)

    closed = client.generate("window-closed", PROMPT_CLOSED, SHOT_WINDOW, [master])
    smile = client.generate("smile", PROMPT_SMILE, SHOT_WINDOW, [master])
    money = client.generate("money", PROMPT_MONEY, SHOT_WINDOW, [smile])

    if args.light:
        frames = [("wide", SHOT_WIDE, find(args.out, "wide")), ("wheel", SHOT_WHEEL, find(args.out, "wheel")),
                  ("window-closed", SHOT_WINDOW, closed), ("master", SHOT_WINDOW, master),
                  ("smile", SHOT_WINDOW, smile), ("money", SHOT_WINDOW, money)]
        for name, shot, src in frames:
            if src is not None:
                client.generate(name + "-light", PROMPT_LIGHT, shot, [src])

    print("\nГотово. Кадры лежат в %s" % args.out)


def cmd_models(args):
    if PROVIDER == "ark":
        sys.exit("Список моделей доступен только для OpenRouter.")
    try:
        result = request(BASE_URL + "/images/models")
    except urllib.error.URLError as err:
        sys.exit("Не удалось получить список моделей: %s" % err)
    for m in result.get("data", []):
        print(m.get("id"), json.dumps({k: v for k, v in m.items() if k != "id"}, ensure_ascii=False)[:300])


def main():
    parser = argparse.ArgumentParser(description="Кадры для анимации ANDO через Seedream")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="папка для результатов")
    parser.add_argument("--dry-run", action="store_true", help="показать запросы, ничего не отправлять")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start", help="общий план, колесо и варианты главного кадра")
    p_start.add_argument("--face", action="append", default=[], help="фото лица (можно несколько раз)")
    p_start.add_argument("--count", type=int, default=4, help="сколько вариантов главного кадра")
    p_start.set_defaults(func=cmd_start)

    p_finish = sub.add_parser("finish", help="стекло, улыбка, деньги из выбранного главного кадра")
    p_finish.add_argument("--master", required=True, help="выбранный master-N")
    p_finish.add_argument("--light", action="store_true", help="сделать версии для светлой темы")
    p_finish.set_defaults(func=cmd_finish)

    p_models = sub.add_parser("models", help="модели картинок, доступные на OpenRouter")
    p_models.set_defaults(func=cmd_models)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
