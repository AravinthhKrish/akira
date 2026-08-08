import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

from model_router import LlmProviderConfig, ModelRouter, ModelRouterConfig


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

    def test_task_model_preference_overrides_role_and_stage_mappings(self):
        router = ModelRouter(
            ModelRouterConfig(
                default_model="gpt-default",
                role_models={"draft_script": "gpt-role"},
                stage_models={"generate_script": "gpt-stage"},
                providers={
                    "openai": LlmProviderConfig(
                        provider_id="openai",
                        label="OpenAI",
                        models=["gpt-task", "gpt-role", "gpt-stage"],
                        default_model="gpt-task",
                    )
                },
                default_provider="openai",
                catalog_enforced=True,
            )
        )

        route = router.resolve(
            task={"type": "news-podcast", "modelPreference": "openai:gpt-task"},
            stage_name="generate_script",
            role="draft_script",
        )

        self.assertEqual(route["model"], "gpt-task")
        self.assertEqual(route["provider"], "openai")
        self.assertEqual(route["source"], "taskPreference")

    def test_runtime_updates_return_sanitized_config(self):
        router = ModelRouter(ModelRouterConfig(default_model="gpt-default"))
        snapshot = router.update(
            {
                "url": "https://router.example/v1/route",
                "authMode": "bearer",
                "credentials": {"bearerToken": "secret-token"},
                "defaultProvider": "openai",
                "providers": [
                    {
                        "id": "openai",
                        "label": "OpenAI",
                        "url": "https://api.example/v1/responses",
                        "authMode": "bearer",
                        "credentials": {"bearerToken": "provider-token"},
                        "models": ["gpt-4.1-mini", "gpt-4.1"],
                        "defaultModel": "gpt-4.1-mini",
                    }
                ],
                "roleModels": {"draft_script": "gpt-4.1"},
            }
        )
        self.assertEqual(snapshot["authMode"], "bearer")
        self.assertTrue(snapshot["credentials"]["hasBearerToken"])
        self.assertEqual(snapshot["roleModels"]["draft_script"], "gpt-4.1")
        self.assertEqual(snapshot["defaultProvider"], "openai")
        self.assertTrue(snapshot["catalogEnforced"])
        self.assertEqual(snapshot["providers"][0]["id"], "openai")
        self.assertTrue(snapshot["providers"][0]["credentials"]["hasBearerToken"])
        self.assertNotIn("provider-token", json.dumps(snapshot))

        route = router.resolve(role="draft_script")
        self.assertEqual(route["model"], "gpt-4.1")
        self.assertEqual(route["provider"], "openai")
        self.assertEqual(route["providerUrl"], "https://api.example/v1/responses")
        self.assertTrue(route["catalogMatched"])

    def test_catalog_enforced_resolution_falls_back_to_configured_model(self):
        router = ModelRouter(
            ModelRouterConfig(
                default_model="gpt-default",
                default_provider="openai",
                catalog_enforced=True,
                providers={
                    "openai": LlmProviderConfig(
                        provider_id="openai",
                        label="OpenAI",
                        models=["gpt-approved"],
                        default_model="gpt-approved",
                    ),
                },
                role_models={"draft_script": "openai:not-approved"},
            )
        )

        route = router.resolve(role="draft_script")
        self.assertEqual(route["provider"], "openai")
        self.assertEqual(route["model"], "gpt-approved")
        self.assertIn("not in provider", route["warning"])

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
