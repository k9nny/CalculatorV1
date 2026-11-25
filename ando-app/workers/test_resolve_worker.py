"""Regression coverage for worker leases, audio timing and native project isolation."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import urllib.request

MODULE = Path(__file__).with_name("resolve_worker.py")
SPEC = importlib.util.spec_from_file_location("ando_resolve_worker", MODULE)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class WorkerTimingTests(unittest.TestCase):
    def test_scene_frames_cover_audio_with_padding_and_form_contiguous_timeline(self):
        story = {"fps": 30, "scenes": [{"minSeconds": 3}, {"minSeconds": 2.5}, {"minSeconds": 3}]}
        seconds = [1, 8.2, 2.8]
        scenes = worker.timing(story, seconds)
        position = 0
        for scene, duration in zip(scenes, seconds, strict=True):
            self.assertEqual(scene["start"], position)
            self.assertGreaterEqual(scene["frames"] / 30 + 1 / 30, duration + 0.35)
            position += scene["frames"]
        self.assertEqual(position, sum(scene["frames"] for scene in scenes))

    def test_mismatched_audio_and_long_clip_are_rejected(self):
        with self.assertRaises(ValueError):
            worker.timing({"scenes": [{}, {}]}, [2])
        with self.assertRaisesRegex(RuntimeError, "three minutes"):
            worker.timing({"fps": 30, "scenes": [{}, {}, {}, {}]}, [50, 50, 50, 50])


class ProtectedRequestTests(unittest.TestCase):
    def test_bearer_and_lease_do_not_follow_cross_origin_or_downgrade_redirect(self):
        handler = worker.SameOriginRedirect()
        request = urllib.request.Request("https://ando.example/api/render/jobs/123/media/0", headers={
            "Authorization": "Bearer worker-secret", "X-Render-Lease": "lease-secret"
        })
        for destination in ["https://attacker.example/collect", "http://ando.example/collect", "https://ando.example:444/collect", "https://ando.example@attacker.example/collect"]:
            with self.subTest(destination=destination):
                with self.assertRaisesRegex(RuntimeError, "another origin"):
                    handler.redirect_request(request, None, 302, "Found", {}, destination)
        same = handler.redirect_request(request, None, 302, "Found", {}, "https://ando.example/api/render/jobs/123/media/0/")
        self.assertEqual(same.get_header("Authorization"), "Bearer worker-secret")

    def test_invalid_remote_transport_and_unexpected_endpoints_fail_before_network(self):
        with patch.object(worker.urllib.request, "build_opener") as opener:
            for base, endpoint in [("http://remote.example", "/api/render/claim"), ("file:///tmp", "/api/render/claim"), ("https://ando.example", "/api/admin/secret")]:
                with self.assertRaises(ValueError):
                    worker.api_request(base, endpoint, "secret")
            opener.assert_not_called()

    def test_api_request_installs_redirect_guard_and_keeps_auth_headers(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.read.return_value = b'{"job":null}'
        with patch.object(worker.urllib.request, "build_opener", return_value=opener) as build:
            self.assertEqual(worker.api_request("https://ando.example", "/api/render/claim", "secret", {"workerId": "resolve"}, lease="lease"), {"job": None})
        self.assertIsInstance(build.call_args.args[0], worker.SameOriginRedirect)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.get_header("X-render-lease"), "lease")


class NativeRenderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.story = {"fps": 30, "sources": [{"kind": "photo"}], "scenes": [{"text": "Kia Rio", "voice": "Киа Рио", "sourceIndex": 0, "minSeconds": 3}]}
        self.manager = MagicMock()
        self.resolve = MagicMock()
        self.resolve.GetProjectManager.return_value = self.manager
        self.manager.LoadProject.return_value = None
        self.project = self.manager.CreateProject.return_value
        self.pool = self.project.GetMediaPool.return_value
        self.clip = MagicMock()
        self.voice = MagicMock()
        self.title = MagicMock()
        self.pool.ImportMedia.side_effect = [[self.clip], [self.voice], [self.title]]
        self.pool.AppendToTimeline.return_value = [MagicMock()]
        self.project.IsRenderingInProgress.return_value = False
        self.project.GetRenderJobStatus.return_value = {"JobStatus": "Complete"}
        self.project.AddRenderJob.return_value = "fixture-render-id"

        def finish_render(_job_ids, _interactive):
            (self.work / "output.mp4").write_bytes(b"x" * 40)
            return True

        self.project.StartRendering.side_effect = finish_render

    def run_render(self, seconds=None):
        with patch.object(worker, "render_title_track", return_value=self.work / "titles.mov"), patch.object(
            worker, "prepare_stills", side_effect=lambda _story, _scenes, media, _work: media
        ):
            return worker.render_native(self.resolve, "abc123", self.story, [self.work / "photo.jpg"], [self.work / "voice.wav"], seconds or [4], self.work)

    def test_dedicated_project_and_narration_timing_do_not_edit_current_operator_project(self):
        output = self.run_render()
        self.assertEqual(output, self.work / "output.mp4")
        self.manager.LoadProject.assert_called_once_with("ANDO-abc123")
        self.manager.CreateProject.assert_called_once_with("ANDO-abc123")
        self.manager.GetCurrentProject.assert_not_called()
        self.manager.DeleteProject.assert_not_called()
        self.project.SetCurrentRenderMode.assert_called_once_with(1)
        self.project.StartRendering.assert_called_once_with(["fixture-render-id"], False)
        entries = [call.args[0][0] for call in self.pool.AppendToTimeline.call_args_list]
        video, voice, title = entries
        self.assertEqual(video["recordFrame"], 0)
        self.assertEqual(voice["recordFrame"], 0)
        self.assertEqual(voice["endFrame"], 120)
        self.assertGreaterEqual(video["endFrame"], 120)
        self.assertEqual(title["trackIndex"], 2)
        self.assertEqual(title["endFrame"], video["endFrame"])

    def test_creation_import_encoder_and_render_failures_are_visible(self):
        cases = [
            ("project", lambda: setattr(self.manager, "CreateProject", MagicMock(return_value=None)), "create the ANDO project"),
            ("import", lambda: setattr(self.pool, "ImportMedia", MagicMock(side_effect=[[], [self.voice], [self.title]])), "import all source media"),
            ("encoder", lambda: setattr(self.project, "SetCurrentRenderFormatAndCodec", MagicMock(return_value=False)), "encoder"),
            ("render", lambda: setattr(self.project, "GetRenderJobStatus", MagicMock(return_value={"JobStatus": "Failed"})), "render failed")
        ]
        for name, change, message in cases:
            with self.subTest(name=name):
                self.setUp()
                change()
                with self.assertRaisesRegex(RuntimeError, message):
                    self.run_render()

    def test_video_duration_is_measured_in_seconds_when_source_fps_differs(self):
        self.story["sources"][0]["kind"] = "video"
        self.clip.GetClipProperty.side_effect = lambda key: {"Frames": "240", "FPS": "24"}.get(key, "")
        self.run_render([8])
        video = self.pool.AppendToTimeline.call_args_list[0].args[0][0]
        self.assertLess(video["endFrame"], 240)
        self.assertGreaterEqual(video["endFrame"] / 24, 8)

    def test_actually_short_video_is_rejected_even_when_its_frame_count_is_high(self):
        self.story["sources"][0]["kind"] = "video"
        self.clip.GetClipProperty.side_effect = lambda key: {"Frames": "180", "FPS": "60"}.get(key, "")
        with self.assertRaisesRegex(RuntimeError, "too short"):
            self.run_render([4])


if __name__ == "__main__":
    unittest.main()
