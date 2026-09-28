#!/usr/bin/env python3
"""Кадры для анимации ANDO через Seedream (BytePlus ModelArk или Volcengine Ark).

Ключ читается из переменной окружения ARK_API_KEY. В коде и в репозитории его быть не должно.

Порядок работы:
  1) python3 seedream_frames.py start --face ref/face1.jpg --face ref/face2.jpg
     Общий план машины, колесо крупно и 4 варианта главного кадра (водитель у открытого окна).
  2) Выберите master-N с самым похожим лицом.
  3) python3 seedream_frames.py finish --master ../assets/raw/master-2.jpg --light
     Стекло закрыто, широкая улыбка, деньги в руке; с --light еще и версии для светлой темы.

Только стандартная библиотека Python 3.8+, ничего устанавливать не нужно.
Проверить запросы без отправки: добавьте --dry-run.

Переменные окружения:
  ARK_API_KEY     ключ API (обязательно)
  ARK_BASE_URL    по умолчанию https://ark.ap-southeast.bytepluses.com/api/v3 (BytePlus);
                  для Volcengine: https://ark.cn-beijing.volces.com/api/v3
  SEEDREAM_MODEL  по умолчанию seedream-4-0-250828; для Volcengine doubao-seedream-4-0-250828.
                  Точный ID модели посмотрите в консоли, где выпущен ключ.
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

BASE_URL = os.environ.get("ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3").rstrip("/")
MODEL = os.environ.get("SEEDREAM_MODEL", "seedream-4-0-250828")
DEFAULT_OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "raw"

SIZE_WIDE = "4096x2304"
SIZE_WHEEL = "2048x1536"
SIZE_WINDOW = "2560x1920"

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


class Client:
    def __init__(self, out, dry_run):
        self.out = pathlib.Path(out)
        self.dry_run = dry_run
        self.key = os.environ.get("ARK_API_KEY", "")
        if not dry_run and not self.key:
            sys.exit("Не задан ARK_API_KEY. Пример: ARK_API_KEY=ваш_ключ python3 seedream_frames.py start ...")
        self.out.mkdir(parents=True, exist_ok=True)

    def generate(self, name, prompt, size, images=()):
        """Один запрос, одна картинка. Возвращает путь к сохраненному файлу."""
        payload = {
            "model": MODEL,
            "prompt": prompt,
            "size": size,
            "response_format": "b64_json",
            "watermark": False,
            "sequential_image_generation": "disabled",
        }
        if self.dry_run:
            shown = dict(payload)
            if images:
                shown["image"] = ["<%s>" % pathlib.Path(p).name for p in images]
            print("\n[dry-run] %s -> POST %s/images/generations\n%s" % (name, BASE_URL, json.dumps(shown, ensure_ascii=False, indent=2)))
            return self.out / (name + ".jpg")

        refs = [data_uri(p) for p in images]
        if refs:
            payload["image"] = refs[0] if len(refs) == 1 else refs
        print("-> %s ..." % name, flush=True)
        body = json.dumps(payload).encode("utf-8")
        for attempt, pause in enumerate((0, 5, 15, 30)):
            if pause:
                print("   повтор через %d с" % pause, flush=True)
                time.sleep(pause)
            req = urllib.request.Request(
                BASE_URL + "/images/generations",
                data=body,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.key},
            )
            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    result = json.loads(resp.read())
                break
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")
                if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                    continue
                sys.exit("Ошибка API %d при генерации %s:\n%s" % (err.code, name, detail))
            except urllib.error.URLError as err:
                if attempt < 3:
                    continue
                sys.exit("Нет соединения с %s: %s" % (BASE_URL, err.reason))

        items = result.get("data") or []
        if not items or "b64_json" not in items[0]:
            sys.exit("API не вернул картинку для %s:\n%s" % (name, json.dumps(result, ensure_ascii=False)[:2000]))
        raw = base64.b64decode(items[0]["b64_json"])
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

    wide = client.generate("wide", PROMPT_WIDE, SIZE_WIDE)
    client.generate("wheel", PROMPT_WHEEL, SIZE_WHEEL, [wide])

    face_refs = " and ".join("image %d" % (i + 1) for i in range(len(faces)))
    car_ref = "image %d" % (len(faces) + 1)
    refs = list(faces) + [wide]
    for n in range(1, args.count + 1):
        client.generate("master-%d" % n, prompt_master(face_refs, car_ref), SIZE_WINDOW, refs)

    print("\nГотово. Выберите master-N с самым похожим лицом и запустите:\n"
          "  python3 seedream_frames.py finish --master %s/master-N.jpg --light" % args.out)


def cmd_finish(args):
    master = pathlib.Path(args.master)
    if not master.exists():
        sys.exit("Файл не найден: %s" % master)
    client = Client(args.out, args.dry_run)

    closed = client.generate("window-closed", PROMPT_CLOSED, SIZE_WINDOW, [master])
    smile = client.generate("smile", PROMPT_SMILE, SIZE_WINDOW, [master])
    money = client.generate("money", PROMPT_MONEY, SIZE_WINDOW, [smile])

    if args.light:
        frames = [("wide", SIZE_WIDE, find(args.out, "wide")), ("wheel", SIZE_WHEEL, find(args.out, "wheel")),
                  ("window-closed", SIZE_WINDOW, closed), ("master", SIZE_WINDOW, master),
                  ("smile", SIZE_WINDOW, smile), ("money", SIZE_WINDOW, money)]
        for name, size, src in frames:
            if src is not None:
                client.generate(name + "-light", PROMPT_LIGHT, size, [src])

    print("\nГотово. Кадры лежат в %s" % args.out)


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

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
