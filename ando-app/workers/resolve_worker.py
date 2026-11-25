"""Render approved ANDO storyboards in a local DaVinci Resolve Studio instance.

The worker pulls render jobs. Publishing remains a separate confirmed step.
FFmpeg prepares timed photo clips and a transparent title track. Resolve
composites the title track, edits the sources and mixes the narration.
"""
import argparse
from array import array
import importlib
import json
import math
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path


ELEVENLABS_VOICE_ID = "txnCCHHGKmYIwrn7HfHQ"  # Alexandr Vlasov - Vibrant and Energetic
ELEVENLABS_SAMPLE_RATE = 24000


class VoiceAccessError(RuntimeError):
    pass


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        old = urllib.parse.urlparse(request.full_url)
        new = urllib.parse.urlparse(new_url)
        if (old.scheme, old.netloc) != (new.scheme, new.netloc):
            raise RuntimeError("The server redirected a protected request to another origin")
        return super().redirect_request(request, fp, code, message, headers, new_url)


def read_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8"))


def write_json(file, data):
    target = Path(file)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(target)


def connect_resolve():
    roots = [os.environ.get("RESOLVE_SCRIPT_API", "")]
    if sys.platform == "win32":
        roots.append(str(Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) /
                         "Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting"))
    elif sys.platform == "darwin":
        roots.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting")
    else:
        roots.append("/opt/resolve/Developer/Scripting")
    for root in roots:
        if root and (Path(root) / "Modules").is_dir():
            sys.path.insert(0, str(Path(root) / "Modules"))
    try:
        module = importlib.import_module("DaVinciResolveScript")
    except ImportError as error:
        raise RuntimeError("DaVinci Resolve Studio scripting module is missing. Install Studio and set RESOLVE_SCRIPT_API.") from error
    resolve = module.scriptapp("Resolve")
    if resolve is None:
        raise RuntimeError("Open DaVinci Resolve Studio and enable Preferences > System > General > External Scripting Using > Local.")
    if "Studio" not in str(resolve.GetProductName()):
        raise RuntimeError("This render worker requires DaVinci Resolve Studio")
    return resolve


def api_request(base, endpoint, token, data=None, lease=None, raw=None, timeout=60):
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise ValueError("Use HTTPS for a remote render server")
    if not endpoint.startswith("/api/render/"):
        raise ValueError("Unexpected render endpoint")
    url = base.rstrip("/") + endpoint
    headers = {"Authorization": "Bearer " + token}
    if lease:
        headers["X-Render-Lease"] = lease
    if raw is not None:
        body = raw
        headers["Content-Type"] = "video/mp4"
    else:
        body = None if data is None else json.dumps(data).encode("utf-8")
        if body is not None:
            headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    opener = urllib.request.build_opener(SameOriginRedirect())
    with opener.open(request, timeout=timeout) as response:
        if endpoint.endswith("/complete"):
            return json.loads(response.read(1024 * 1024))
        if "/media/" in endpoint:
            content = response.read(512 * 1024 * 1024 + 1)
            if len(content) > 512 * 1024 * 1024:
                raise RuntimeError("Source media exceeds 512 MB")
            return content, response.headers.get_content_type()
        return json.loads(response.read(1024 * 1024))


def connect_elevenlabs():
    env_file = Path(os.environ.get("ANDO_ELEVENLABS_ENV_FILE") or Path(__file__).resolve().parents[2] / ".env.local")
    if env_file.is_file():
        from dotenv import load_dotenv

        load_dotenv(env_file)
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise VoiceAccessError("Нужен ключ ElevenLabs на компьютере с DaVinci.")
    from elevenlabs import ElevenLabs

    return ElevenLabs(timeout=90)


def speak_elevenlabs(client, text, file, previous_text=None, next_text=None):
    from elevenlabs.core.api_error import ApiError

    audio = bytearray()
    try:
        for chunk in client.text_to_speech.convert(
            voice_id=ELEVENLABS_VOICE_ID,
            model_id="eleven_v4",
            language_code="ru",
            text=text,
            output_format="pcm_24000",
            previous_text=previous_text,
            next_text=next_text,
        ):
            audio.extend(chunk)
            if len(audio) > ELEVENLABS_SAMPLE_RATE * 2 * 60:
                raise RuntimeError("ElevenLabs narration exceeded 60 seconds")
    except ApiError as error:
        if error.status_code in (401, 402, 403, 404):
            raise VoiceAccessError(
                f"ElevenLabs HTTP {error.status_code}. Проверьте доступ к Alexandr Vlasov в API, тариф и остаток кредитов."
            ) from None
        raise RuntimeError(f"ElevenLabs narration failed (HTTP {error.status_code})") from None
    if not audio or len(audio) % 2:
        raise RuntimeError("ElevenLabs returned empty or incomplete PCM audio")
    with wave.open(str(file), "wb") as wav:
        wav.setparams((1, 2, ELEVENLABS_SAMPLE_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(audio)
    return len(audio) / (2 * ELEVENLABS_SAMPLE_RATE)


def timing(story, seconds):
    fps = int(story.get("fps", 30))
    position = 0
    result = []
    for scene, duration in zip(story["scenes"], seconds, strict=True):
        frames = round(max(float(scene.get("minSeconds", 3)), duration + 0.35) * fps)
        result.append({**scene, "start": position, "frames": frames})
        position += frames
    if position / fps > 180:
        raise RuntimeError("Storyboard is longer than three minutes")
    return result


def ass_time(frame, fps):
    ticks = round(frame * 100 / fps)
    seconds, fraction = divmod(ticks, 100)
    minutes, seconds = divmod(seconds, 60)
    return f"{minutes // 60}:{minutes % 60:02}:{seconds:02}.{fraction:02}"


def render_title_track(scenes, fps, work):
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ANDO,Arial,60,&H00FFFFFF,&H00FFFFFF,&H00321B10,&H80321B10,-1,0,0,0,100,100,0,0,1,4,3,2,96,96,96,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for scene in scenes:
        start = scene["start"]
        end = start + scene["frames"]
        text = " ".join(scene["text"].replace("\r", "").split("\t")).translate(str.maketrans("\\{}", "＼｛｝"))
        size = 60 if len(text) < 65 else 48
        motion = {
            "slide": r"\move(612,1475,540,1475,0,340)",
            "push-in": r"\pos(540,1475)\fscx92\fscy92\t(0,340,\fscx100\fscy100)",
        }.get(scene.get("animation"), r"\move(540,1550,540,1475,0,340)")
        title = r"{\an2\fad(245,205)\fs" + str(size) + motion + "}" + text.replace("\n", r"\N")
        events.append(f"Dialogue: 0,{ass_time(start, fps)},{ass_time(end, fps)},ANDO,,0,0,0,,{title}")
    (work / "titles.ass").write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    output = work / "titles.mov"
    try:
        subprocess.run([
            os.environ.get("FFMPEG_PATH", "ffmpeg"), "-nostdin", "-v", "error", "-y",
            "-f", "lavfi", "-i", f"color=c=black@0:s=1080x1920:r={fps},format=rgba",
            "-vf", "ass=filename=titles.ass:alpha=1", "-frames:v", str(end), "-an",
            "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", str(output),
        ], cwd=work, capture_output=True, check=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("FFmpeg with libass could not prepare animated titles for Resolve") from error
    return output


def prepare_stills(story, scenes, media_files, work):
    durations = {}
    for scene in scenes:
        index = scene["sourceIndex"]
        if story["sources"][index]["kind"] == "photo":
            durations[index] = max(durations.get(index, 0), scene["frames"])
    inputs = list(media_files)
    fps = int(story["fps"])
    for index, frames in durations.items():
        output = work / f"still-{index}.mp4"
        try:
            subprocess.run([
                os.environ.get("FFMPEG_PATH", "ffmpeg"), "-nostdin", "-v", "error", "-y",
                "-f", "image2", "-pattern_type", "none", "-loop", "1", "-framerate", str(fps),
                "-i", str(inputs[index]), "-frames:v", str(frames), "-an",
                "-vf", "scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", str(output),
            ], capture_output=True, check=True, timeout=180)
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError("FFmpeg could not prepare photo " + str(index + 1) + " for Resolve") from error
        inputs[index] = output
    return inputs


def backing_track(scenes, fps, work):
    folder = os.environ.get("ANDO_AUDIO_PACK_DIR")
    if not folder:
        return None
    root = Path(folder)
    rate = 48000
    frames = round((scenes[-1]["start"] + scenes[-1]["frames"]) / fps * rate)
    mixed = array("h", [0]) * (frames * 2)

    def add(relative, start, gain):
        with wave.open(str(root / relative), "rb") as source:
            channels = source.getnchannels()
            if source.getframerate() != rate or source.getsampwidth() != 2 or channels not in (1, 2):
                raise RuntimeError("В аудиопаке нужен PCM WAV 48 кГц, 16 бит")
            audio = array("h", source.readframes(min(source.getnframes(), frames - start)))
        if sys.byteorder != "little":
            audio.byteswap()
        for i in range(len(audio) // channels):
            position = start + i
            fade = min(1, (frames - position) / (rate * 0.45))
            for channel in (0, 1):
                target = position * 2 + channel
                sample = audio[i * channels + (channel if channels == 2 else 0)]
                mixed[target] = max(-32768, min(32767, mixed[target] + round(sample * gain * fade)))

    add("Music/01-night-drive-108bpm.wav", 0, 0.23)
    effects = {
        0: "01-air-whoosh.wav", 1: "02-camera-shutter.wav",
        2: "03-price-impact.wav", len(scenes) - 1: "08-outro-chime.wav",
    }
    for index, name in effects.items():
        if index < len(scenes):
            add("SFX/" + name, round(scenes[index]["start"] / fps * rate), 0.35)
    output = work / "music-and-sfx.wav"
    if sys.byteorder != "little":
        mixed.byteswap()
    with wave.open(str(output), "wb") as destination:
        destination.setparams((2, 2, rate, 0, "NONE", "not compressed"))
        destination.writeframes(mixed.tobytes())
    return output


def render_native(resolve, job_id, story, media_files, audio_files, seconds, work, progress=None):
    manager = resolve.GetProjectManager()
    name = "ANDO-" + job_id
    project = manager.LoadProject(name) or manager.CreateProject(name)
    if not project:
        raise RuntimeError("Resolve could not create the ANDO project")
    # A dedicated project prevents changing the operator's current edit.
    for key, value in {"timelineResolutionWidth": "1080", "timelineResolutionHeight": "1920", "timelineFrameRate": "30"}.items():
        if not project.SetSetting(key, value):
            raise RuntimeError("Resolve rejected setting " + key)
    pool = project.GetMediaPool()
    timeline = pool.CreateEmptyTimeline("ANDO-" + job_id + "-" + str(int(time.time())))
    if not timeline or not project.SetCurrentTimeline(timeline):
        raise RuntimeError("Resolve could not create the timeline")
    if not timeline.SetStartTimecode("00:00:00:00"):
        raise RuntimeError("Resolve could not set the timeline start")
    scenes = timing(story, seconds)
    inputs = prepare_stills(story, scenes, media_files, work)
    title_file = render_title_track(scenes, int(story["fps"]), work)
    clips = pool.ImportMedia([str(file) for file in inputs])
    voices = pool.ImportMedia([str(file) for file in audio_files])
    titles = pool.ImportMedia([str(title_file)])
    if not clips or len(clips) != len(media_files) or not voices or len(voices) != len(audio_files) or not titles:
        raise RuntimeError("Resolve did not import all source media")
    if not timeline.AddTrack("video"):
        raise RuntimeError("Resolve could not add the title track")
    for index, scene in enumerate(scenes):
        if progress:
            progress()
        clip = clips[scene["sourceIndex"]]
        duration = scene["frames"]
        if story["sources"][scene["sourceIndex"]]["kind"] == "video":
            available = int(float(clip.GetClipProperty("Frames") or 0))
            source_fps = float(clip.GetClipProperty("FPS") or story["fps"])
            duration = math.ceil(duration * source_fps / story["fps"])
            if available and available < duration:
                raise RuntimeError("Source video is too short for a scene. Add a longer shot or use a photo.")
        added = pool.AppendToTimeline([{"mediaPoolItem": clip, "startFrame": 0, "endFrame": duration,
                                        "recordFrame": scene["start"], "trackIndex": 1, "mediaType": 1}])
        if not added:
            raise RuntimeError("Resolve did not append scene " + str(index + 1))
        voice_frames = max(1, round(seconds[index] * 30))
        if not pool.AppendToTimeline([{"mediaPoolItem": voices[index], "startFrame": 0, "endFrame": voice_frames,
                                       "recordFrame": scene["start"], "trackIndex": 1, "mediaType": 2}]):
            raise RuntimeError("Resolve did not append narration")
    total_frames = scenes[-1]["start"] + scenes[-1]["frames"]
    backing = backing_track(scenes, int(story["fps"]), work)
    if backing:
        music = pool.ImportMedia([str(backing)])
        if not music or not timeline.AddTrack("audio", "stereo") or not pool.AppendToTimeline(
            [{"mediaPoolItem": music[0], "startFrame": 0, "endFrame": total_frames,
              "recordFrame": 0, "trackIndex": 2, "mediaType": 2}]
        ):
            raise RuntimeError("Не удалось добавить музыку и эффекты на дорожку DaVinci.")
    if not pool.AppendToTimeline([{"mediaPoolItem": titles[0], "startFrame": 0, "endFrame": total_frames,
                                   "recordFrame": 0, "trackIndex": 2, "mediaType": 1}]):
        raise RuntimeError("Resolve did not append the animated title track")
    if not manager.SaveProject():
        raise RuntimeError("Resolve did not save the project")
    if not project.SetCurrentRenderMode(1):
        raise RuntimeError("Resolve did not select single-clip export")
    if not project.SetCurrentRenderFormatAndCodec("mp4", "H264"):
        raise RuntimeError("Select a supported MP4/H.264 encoder in Resolve Studio")
    if not project.SetRenderSettings({"TargetDir": str(work), "CustomName": "output", "SelectAllFrames": True,
                                      "ExportVideo": True, "ExportAudio": True, "FormatWidth": 1080,
                                      "FormatHeight": 1920, "FrameRate": 30}):
        raise RuntimeError("Resolve rejected the render settings")
    render_id = project.AddRenderJob()
    if not render_id or not project.StartRendering([render_id], False):
        raise RuntimeError("Resolve did not start the render")
    deadline = time.monotonic() + 3600
    try:
        while project.IsRenderingInProgress():
            if time.monotonic() > deadline:
                raise RuntimeError("Resolve render exceeded one hour")
            if progress:
                progress()
            time.sleep(3)
    except Exception:
        project.StopRendering()
        raise
    status = project.GetRenderJobStatus(render_id)
    if status.get("JobStatus") != "Complete":
        raise RuntimeError("Resolve render failed: " + str(status.get("JobStatus")))
    output = work / "output.mp4"
    if not output.is_file() or output.stat().st_size < 32:
        raise RuntimeError("Resolve did not produce output.mp4")
    return output


def process_claim(base, token, job, root, worker_id, elevenlabs_client):
    job_id = job["id"]
    if not job_id.isalnum() or len(job_id) > 64:
        raise ValueError("Unexpected job ID")
    lease = job["leaseToken"]
    prefix = "/api/render/jobs/" + job_id
    work = root / job_id
    work.mkdir(parents=True, exist_ok=True)
    stopped = threading.Event()
    failures = []

    def pulse():
        while not stopped.wait(45):
            try:
                api_request(base, prefix + "/heartbeat", token, {"workerId": worker_id}, lease)
            except Exception as error:
                failures.append(error)
                return

    def progress():
        if failures:
            raise RuntimeError("Render lease was lost. The job will be reconciled by the server.")

    heartbeat = threading.Thread(target=pulse, daemon=True)
    heartbeat.start()
    try:
        resolve = connect_resolve()
        media_files = []
        for source in job["sources"]:
            data, content_type = api_request(base, prefix + "/media/" + str(source["index"]), token, lease=lease, timeout=180)
            extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/webm": ".webm"}.get(content_type, ".mp4")
            file = work / ("media-" + str(source["index"]) + extension)
            file.write_bytes(data)
            media_files.append(file)
        story = job["storyboard"]
        story["sources"] = job["sources"]
        audio_files, seconds = [], []
        narration = [scene["voice"] for scene in story["scenes"]]
        for index, text in enumerate(narration):
            progress()
            file = work / ("voice-" + str(index) + ".wav")
            previous_text = narration[index - 1] if index else None
            next_text = narration[index + 1] if index + 1 < len(narration) else None
            seconds.append(speak_elevenlabs(elevenlabs_client, text, file, previous_text, next_text))
            audio_files.append(file)
        write_json(work / "storyboard.json", story)
        output = render_native(resolve, job_id, story, media_files, audio_files, seconds, work, progress)
        progress()
        # Repeating completion with the same lease is idempotent on the server.
        for attempt in range(3):
            try:
                return api_request(base, prefix + "/complete", token, lease=lease, raw=output.read_bytes(), timeout=300)
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(5)
    finally:
        stopped.set()
        heartbeat.join(timeout=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--server", default=os.environ.get("ANDO_SERVER_URL", ""))
    parser.add_argument("--work-dir", default=os.environ.get("RESOLVE_WORK_DIR", "data-private/resolve-worker"))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.doctor:
        try:
            resolve = connect_resolve()
            print(json.dumps({"ready": True, "product": resolve.GetProductName(), "version": resolve.GetVersionString()}))
        except Exception as error:
            print(json.dumps({"ready": False, "error": str(error)}))
            return 1
        return 0
    token = os.environ.get("RENDER_WORKER_TOKEN", "")
    if not args.server or not token:
        parser.error("Set ANDO_SERVER_URL and RENDER_WORKER_TOKEN in the worker environment")
    try:
        elevenlabs_client = connect_elevenlabs()
    except VoiceAccessError as error:
        parser.error(str(error))
    root = Path(args.work_dir).resolve()
    worker_id = os.environ.get("RENDER_WORKER_ID", "resolve-local")
    while True:
        job = None
        try:
            connect_resolve()
            response = api_request(args.server, "/api/render/claim", token, {"workerId": worker_id})
            job = response.get("job")
            if job:
                process_claim(args.server, token, job, root, worker_id, elevenlabs_client)
                print(json.dumps({"jobId": job["id"], "status": "ready"}), flush=True)
        except Exception as error:
            message = str(error)[:400]
            print(json.dumps({"status": "error", "message": message}), flush=True)
            if job:
                try:
                    api_request(args.server, "/api/render/jobs/" + job["id"] + "/fail", token,
                                {"error": message, "permanent": isinstance(error, VoiceAccessError)}, job["leaseToken"])
                except Exception:
                    pass
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(15)


if __name__ == "__main__":
    sys.exit(main())
