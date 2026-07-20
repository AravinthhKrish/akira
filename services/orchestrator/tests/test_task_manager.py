import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

import server
from mcp_client import MCPClient, fallback_articles
from model_router import ModelRouter, ModelRouterConfig
from server import (
    TaskManager,
    build_news_search_query,
    normalize_news_schedule,
)
from worker_client import WorkerClient


class MemoryStorage:
    def __init__(self):
        self.tasks = {}
        self.events = {}
        self.artifacts = {}
        self.vectors = {}

    def list_tasks(self):
        return list(self.tasks.values())

    def get_task(self, task_id):
        return self.tasks[task_id]

    def upsert_task(self, task_id, task):
        self.tasks[task_id] = dict(task)
        return self.tasks[task_id]

    def append_event(self, event):
        self.events.setdefault(event["data"]["task_id"], []).append(event)
        return event

    def get_events(self, task_id, from_seq=0):
        return [
            event
            for event in self.events.get(task_id, [])
            if event["data"]["event_seq"] >= from_seq
        ]

    def save_artifact(self, task_id, artifact_id, artifact):
        record = dict(artifact)
        self.artifacts.setdefault(task_id, {})[artifact_id] = record
        return record

    def list_artifacts(self, task_id):
        return list(self.artifacts.get(task_id, {}).values())

    def upsert_vectors(self, namespace, items):
        self.vectors[namespace] = list(items)
        return {"namespace": namespace, "count": len(items)}


class RecordingMCPClient(MCPClient):
    def __init__(self):
        super().__init__(None)
        self.queries = []

    def search_news(self, topic: str, limit: int = 6) -> dict:
        self.queries.append({"topic": topic, "limit": limit})
        return {
            "articles": fallback_articles(topic)[:limit],
            "freshness": "recorded-local",
        }


class TestableTaskManager(TaskManager):
    def _spawn(self, task_id: str, resume: bool = False):
        return None


class SyncTaskManager(TestableTaskManager):
    def _spawn(self, task_id: str, resume: bool = False):
        self._run_task(task_id, resume=resume)


class MonitoringTaskManager(TestableTaskManager):
    def _collect_health(self) -> dict:
        return {
            "dashboard": {"ok": True, "payload": {"ok": True}},
            "orchestrator": {"ok": True, "payload": {"ok": True}},
            "storage": {"ok": False, "error": "timeout"},
        }

    def _collect_metrics(self) -> dict:
        return {
            "dashboard": {"ok": True, "residentMemoryKb": 1234, "errorCount": 0, "raw": {}},
            "orchestrator": {"ok": True, "residentMemoryKb": 4321, "errorCount": 1, "raw": {}},
            "storage": {"ok": False, "residentMemoryKb": 999, "errorCount": 2, "raw": {}},
        }

    def _read_monitoring_logs(self, start_time, end_time):
        return "local", [
            {"dateTime": start_time.isoformat(), "serviceName": "orchestrator", "logLevel": "INFO"},
            {"dateTime": end_time.isoformat(), "serviceName": "storage", "logLevel": "ERROR"},
        ]


class TaskManagerTests(unittest.TestCase):
    def test_dashboard_overview_prioritizes_content_tasks_over_monitoring_tasks(self):
        storage = MemoryStorage()
        manager = MonitoringTaskManager(storage, MCPClient(None), WorkerClient(None))
        storage.upsert_task(
            "monitor_001",
            {
                "taskId": "monitor_001",
                "runId": "monitor_run_001",
                "type": "system-monitoring",
                "topic": "system monitoring podcast",
                "status": "working",
                "priority": "normal",
                "stageIndex": 0,
                "stage": "collect_monitoring_inputs",
                "eventSeq": 0,
                "narrativeSeq": 0,
                "updatedAt": "2026-07-05T01:30:00+00:00",
                "artifacts": [],
            },
        )
        storage.upsert_task(
            "task_001",
            {
                "taskId": "task_001",
                "runId": "run_001",
                "type": "news-podcast",
                "topic": "AKIRA launch plan",
                "status": "working",
                "priority": "normal",
                "stageIndex": 3,
                "stage": "draft_structure",
                "eventSeq": 0,
                "narrativeSeq": 0,
                "updatedAt": "2026-07-05T01:31:00+00:00",
                "artifacts": [],
            },
        )

        overview = manager.get_dashboard_overview()

        self.assertEqual(overview["cards"][1]["value"], 1)
        self.assertEqual(overview["hero"]["task"]["taskId"], "task_001")
        self.assertEqual([task["taskId"] for task in overview["tasks"]], ["task_001"])
        self.assertTrue(all(task["type"] != "system-monitoring" for task in overview["tasks"]))

    def test_run_task_produces_script_package(self):
        storage = MemoryStorage()
        manager = TestableTaskManager(storage, MCPClient(None), WorkerClient(None))
        with patch.object(server.time, "sleep", lambda *_args, **_kwargs: None):
            task = manager.create_task("agent podcast")
            manager._run_task(task["taskId"])
        completed = storage.get_task(task["taskId"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(storage.list_artifacts(task["taskId"])), 1)
        artifact = storage.list_artifacts(task["taskId"])[0]
        self.assertTrue(artifact["scriptSections"])
        self.assertGreaterEqual(len(storage.get_events(task["taskId"])), 8)

    def test_run_task_uses_dynamic_model_router_configuration(self):
        storage = MemoryStorage()
        router = ModelRouter(
            ModelRouterConfig(
                default_model="gpt-default",
                role_models={"draft_script": "gpt-role-script"},
                stage_models={"validate_citations": "gpt-stage-validation"},
            )
        )
        manager = TestableTaskManager(storage, MCPClient(None), WorkerClient(None), model_router=router)
        with patch.object(server.time, "sleep", lambda *_args, **_kwargs: None):
            task = manager.create_task("agent podcast")
            manager._run_task(task["taskId"])
        completed = storage.get_task(task["taskId"])
        self.assertEqual(completed["modelRouting"]["generate_script"]["model"], "gpt-role-script")
        self.assertEqual(completed["modelRouting"]["validate_citations"]["model"], "gpt-stage-validation")
        models = manager.usage_tracker.by_model(15)["models"]
        self.assertIn("gpt-role-script", models)
        self.assertIn("gpt-stage-validation", models)

    def test_news_context_builds_expanded_query_and_persists_profile(self):
        storage = MemoryStorage()
        mcp = RecordingMCPClient()
        manager = TestableTaskManager(storage, mcp, WorkerClient(None))
        news_context = {
            "topic": "AKIRA launch",
            "focusKeywords": ["voice", "orchestration"],
            "exclusions": ["rumors"],
            "entities": ["AKIRA", "MCP"],
            "sourcePreferences": ["official docs", "reputable news"],
            "freshnessWindowMinutes": 180,
        }
        news_schedule = {"enabled": True, "refreshEveryMinutes": 45}

        with patch.object(server.time, "sleep", lambda *_args, **_kwargs: None):
            task = manager.create_task("AKIRA launch", news_context=news_context, news_schedule=news_schedule)
            manager._run_task(task["taskId"])

        stored = storage.get_task(task["taskId"])
        expected_query = build_news_search_query(stored)

        self.assertEqual(stored["newsContext"]["topic"], "AKIRA launch")
        self.assertEqual(stored["newsContext"]["freshnessWindowMinutes"], 180)
        self.assertEqual(stored["newsSchedule"]["refreshEveryMinutes"], 45)
        self.assertTrue(stored["newsSchedule"]["enabled"])
        self.assertEqual(stored["newsQuery"], expected_query)
        self.assertTrue(mcp.queries)
        self.assertEqual(mcp.queries[0]["topic"], expected_query)
        self.assertIn("focus on voice, orchestration", expected_query)
        self.assertIn("cover entities AKIRA, MCP", expected_query)
        self.assertIn("exclude rumors", expected_query)
        self.assertIn("prefer sources official docs, reputable news", expected_query)
        self.assertIn("freshness window last 180 minutes", expected_query)

    def test_normalize_news_schedule_defaults_and_zero_values(self):
        now = datetime(2026, 7, 20, tzinfo=timezone.utc)
        schedule = normalize_news_schedule({"enabled": True, "refreshEveryMinutes": "0"}, now=now)
        disabled = normalize_news_schedule({"enabled": "false", "refreshEveryMinutes": "30"}, now=now)

        self.assertTrue(schedule["enabled"])
        self.assertEqual(schedule["refreshEveryMinutes"], 60)
        self.assertEqual(schedule["nextRefreshAt"], "2026-07-20T01:00:00+00:00")
        self.assertFalse(disabled["enabled"])
        self.assertIsNone(disabled["nextRefreshAt"])

    def test_scheduled_refresh_replays_context_refresh_events(self):
        storage = MemoryStorage()
        mcp = RecordingMCPClient()
        manager = SyncTaskManager(storage, mcp, WorkerClient(None))

        with patch.object(server.time, "sleep", lambda *_args, **_kwargs: None):
            task = manager.create_task(
                "AKIRA agent podcast",
                news_context={"topic": "AKIRA agent podcast", "focusKeywords": ["voice"]},
                news_schedule={"enabled": True, "refreshEveryMinutes": 15},
            )

        refreshed = storage.get_task(task["taskId"])
        refreshed["newsSchedule"]["nextRefreshAt"] = "2026-07-19T23:00:00+00:00"
        refreshed["updatedAt"] = "2026-07-19T22:00:00+00:00"
        storage.upsert_task(task["taskId"], refreshed)

        with patch.object(server.time, "sleep", lambda *_args, **_kwargs: None):
            manager._refresh_due_news_tasks()

        latest = storage.get_task(task["taskId"])
        replay = manager.get_replay(task["taskId"])

        self.assertEqual(latest["newsSchedule"]["refreshCount"], 1)
        self.assertTrue(latest["newsSchedule"]["lastRefreshAt"])
        self.assertGreaterEqual(len(mcp.queries), 2)
        self.assertTrue(any("refresh armed" in event["data"]["message"] for event in replay))
        self.assertTrue(any(event["data"]["audience"] == "narrative" for event in replay))

    def test_generate_monitoring_digest_creates_audio_first_artifact(self):
        storage = MemoryStorage()
        manager = MonitoringTaskManager(storage, MCPClient(None), WorkerClient(None))
        result = manager.generate_monitoring_digest(trigger="manual", window_minutes=15)
        artifact = result["artifact"]
        self.assertEqual(artifact["type"], "monitoring-podcast")
        self.assertEqual(artifact["audio"]["mode"], "audio-first")
        self.assertTrue(artifact["audio"]["status"].startswith("generated-"))
        self.assertTrue(artifact["audio"]["base64Data"])
        self.assertIn(artifact["audio"]["mimeType"], {"audio/wav", "audio/aiff"})
        self.assertTrue(artifact["headline"])
        self.assertEqual(result["task"]["status"], "completed")

    def test_monitoring_overview_includes_health_usage_and_digests(self):
        storage = MemoryStorage()
        manager = MonitoringTaskManager(storage, MCPClient(None), WorkerClient(None))
        manager.generate_monitoring_digest(trigger="manual", window_minutes=15)
        overview = manager.get_monitoring_overview(window_minutes=15, digest_limit=3)
        self.assertIn("health", overview)
        self.assertIn("metrics", overview)
        self.assertIn("usage", overview)
        self.assertTrue(overview["latestDigests"])
        self.assertEqual(overview["windowMinutes"], 15)
        self.assertEqual(overview["logSource"], "local")


if __name__ == "__main__":
    unittest.main()
