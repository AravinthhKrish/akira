import sys
import time
import unittest
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

from mcp_client import MCPClient
from server import TaskManager
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


class TestableTaskManager(TaskManager):
    def _spawn(self, task_id: str, resume: bool = False):
        return None


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
    def test_run_task_produces_script_package(self):
        storage = MemoryStorage()
        manager = TestableTaskManager(storage, MCPClient(None), WorkerClient(None))
        task = manager.create_task("agent podcast")
        manager._run_task(task["taskId"])
        completed = storage.get_task(task["taskId"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(storage.list_artifacts(task["taskId"])), 1)
        artifact = storage.list_artifacts(task["taskId"])[0]
        self.assertTrue(artifact["scriptSections"])
        self.assertGreaterEqual(len(storage.get_events(task["taskId"])), 8)

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
