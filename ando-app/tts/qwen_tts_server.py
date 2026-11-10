"""Озвучка роликов ANDO AUTO через Qwen3-TTS (Apache 2.0).

Держит модель в памяти и отвечает на POST /speak {"text": "..."} файлом WAV.
Голос задаётся одним из двух способов (файлы в папке VOICE_DIR):

  ref.wav + ref.txt  - свой голос: запись 10-20 секунд и её точный текст;
  voice.txt          - описание голоса словами, например «мужской, спокойный...».
                       Из описания один раз создаётся ref.wav, дальше голос не меняется.

Запуск:  python tts/qwen_tts_server.py
Настройки через переменные окружения: QWEN_TTS_MODEL (по умолчанию 1.7B-Base),
QWEN_TTS_PORT (8765), VOICE_DIR (data-private/voice).
"""
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ROOT = Path(__file__).resolve().parent.parent
VOICE_DIR = Path(os.environ.get("VOICE_DIR", ROOT / "data-private" / "voice"))
BASE_MODEL = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
DESIGN_MODEL = os.environ.get("QWEN_TTS_DESIGN_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
PORT = int(os.environ.get("QWEN_TTS_PORT", "8765"))
LANG = "Russian"
DESIGN_TEXT = (
    "Здравствуйте! Это Андо Авто. Сегодня покажу машину, которую мы проверили в нашем сервисе: "
    "цена, пробег и всё, что сделали перед продажей."
)


def device_settings():
    if torch.cuda.is_available():
        kw = {"device_map": "cuda:0", "dtype": torch.bfloat16}
        try:
            import flash_attn  # noqa: F401
            kw["attn_implementation"] = "flash_attention_2"
        except ImportError:
            pass
        return kw
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return {"device_map": "mps", "dtype": torch.float32}
    return {"device_map": "cpu", "dtype": torch.float32}


def load_voice(kw):
    ref_wav, ref_txt, desc = VOICE_DIR / "ref.wav", VOICE_DIR / "ref.txt", VOICE_DIR / "voice.txt"
    if not ref_wav.exists():
        if not desc.exists():
            sys.exit(f"Нет голоса: положите {ref_wav} и {ref_txt} (свой голос) или {desc} (описание голоса).")
        print("Создаю голос по описанию из voice.txt ...", flush=True)
        design = Qwen3TTSModel.from_pretrained(DESIGN_MODEL, **kw)
        wavs, sr = design.generate_voice_design(text=DESIGN_TEXT, language=LANG,
                                                instruct=desc.read_text(encoding="utf-8").strip())
        sf.write(ref_wav, wavs[0], sr)
        ref_txt.write_text(DESIGN_TEXT, encoding="utf-8")
        del design
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print(f"Голос сохранён в {ref_wav}. Не понравился — удалите ref.wav и поменяйте voice.txt.", flush=True)
    return str(ref_wav), ref_txt.read_text(encoding="utf-8").strip()


def main():
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    kw = device_settings()
    print(f"Устройство: {kw['device_map']}. Загружаю модель {BASE_MODEL} ...", flush=True)
    ref_audio, ref_text = load_voice(kw)
    model = Qwen3TTSModel.from_pretrained(BASE_MODEL, **kw)
    prompt = model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self._reply(200, b"ok", "text/plain") if self.path == "/healthz" else self._reply(404, b"", "text/plain")

        def do_POST(self):
            if self.path != "/speak":
                return self._reply(404, b"", "text/plain")
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                text = str(body.get("text", "")).strip()[:1000]
                if not text:
                    return self._reply(400, "пустой текст".encode(), "text/plain; charset=utf-8")
                with lock:  # одна генерация за раз
                    wavs, sr = model.generate_voice_clone(text=text, language=LANG, voice_clone_prompt=prompt)
                buf = io.BytesIO()
                sf.write(buf, wavs[0], sr, format="WAV")
                self._reply(200, buf.getvalue(), "audio/wav")
            except Exception as e:  # noqa: BLE001
                self._reply(500, str(e).encode(), "text/plain; charset=utf-8")

        def _reply(self, code, data, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    print(f"Готово: http://127.0.0.1:{PORT}/speak", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
