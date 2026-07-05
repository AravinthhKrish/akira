import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

from model_router import ModelRouter, ModelRouterConfig


class DummyResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class ModelRouterTests(unittest.TestCase):
    def test_local_resolution_prefers_role_stage_then_default(self):
        router = ModelRouter(
            ModelRouterConfig(
                default_model="gpt-default",
                role_models={"draft_script": "gpt-role"},
                stage_models={"validate_citations": "gpt-stage"},
                task_type_models={"system-monitoring": "gpt-task"},
            )
        )
        self.assertEqual(router.resolve(role="draft_script")["model"], "gpt-role")
        self.assertEqual(router.resolve(stage_name="validate_citations")["model"], "gpt-stage")
        self.assertEqual(router.resolve(task={"type": "system-monitoring"})["model"], "gpt-task")
        self.assertEqual(router.resolve()["model"], "gpt-default")

    def test_runtime_updates_return_sanitized_config(self):
        router = ModelRouter(ModelRouterConfig(default_model="gpt-default"))
        snapshot = router.update(
            {
                "url": "https://router.example/v1/route",
                "authMode": "bearer",
                "credentials": {"bearerToken": "secret-token"},
                "roleModels": {"draft_script": "gpt-4.1"},
            }
        )
        self.assertEqual(snapshot["authMode"], "bearer")
        self.assertTrue(snapshot["credentials"]["hasBearerToken"])
        self.assertEqual(snapshot["roleModels"]["draft_script"], "gpt-4.1")

    def test_remote_resolution_uses_auth_headers(self):
        router = ModelRouter(
            ModelRouterConfig(
                url="https://router.example/v1/route",
                auth_mode="basic",
                basic_username="akira",
                basic_password="secret",
            )
        )
        captured = {}

        def fake_urlopen(request, timeout=0):
            captured["timeout"] = timeout
            captured["headers"] = dict(request.header_items())
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return DummyResponse({"model": "gpt-4.1"})

        with patch("model_router.urllib.request.urlopen", side_effect=fake_urlopen):
            result = router.resolve(task={"taskId": "task_1", "type": "news-podcast"}, stage_name="draft_script", role="draft_script", fallback_model="gpt-4.1-mini")

        self.assertEqual(result["model"], "gpt-4.1")
        self.assertEqual(captured["timeout"], 15)
        self.assertEqual(captured["headers"]["Authorization"], "Basic YWtpcmE6c2VjcmV0")
        self.assertEqual(captured["payload"]["stage"], "draft_script")
        self.assertEqual(captured["payload"]["role"], "draft_script")


if __name__ == "__main__":
    unittest.main()
