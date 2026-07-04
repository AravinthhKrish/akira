from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CURRENT_DIR = Path(__file__).parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from mcp_client import MCPClient
from audio_renderer import render_audio_payload
from log_reader import MonitoringLogReader
from observability import MetricsRegistry, StructuredLogger, UsageTracker, now_iso
from storage_client import StorageClient
from worker_client import WorkerClient
from workflow import STAGES, build_news_graph


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def task_progress(task: dict) -> int:
    index = min(int(task.get("stageIndex", 0)), len(STAGES) - 1)
    return STAGES[index].progress if STAGES else 0


def parse_window_minutes(value: str | None, default: int = 15) -> int:
    if not value:
        return default
    normalized = value.strip().lower()
    if normalized.endswith("m"):
        normalized = normalized[:-1]
    try:
        return max(1, int(normalized))
    except ValueError:
        return default


class TaskManager:
    def __init__(
        self,
        storage: StorageClient,
        mcp: MCPClient,
        workers: WorkerClient,
        *,
        logger: StructuredLogger | None = None,
        metrics: MetricsRegistry | None = None,
        usage_tracker: UsageTracker | None = None,
        service_urls: dict[str, str] | None = None,
    ):
        self.storage = storage
        self.mcp = mcp
        self.workers = workers
        self.graph = build_news_graph()
        self.lock = threading.RLock()
        self.tasks: dict[str, dict] = {}
        self.threads: dict[str, threading.Thread] = {}
        self.logger = logger or StructuredLogger("orchestrator")
        self.metrics = metrics or MetricsRegistry("orchestrator")
        self.usage_tracker = usage_tracker or UsageTracker()
        self.log_dir = Path(os.environ.get("OBSERVABILITY_LOG_DIR", "data/observability/logs"))
        self.elastic_url = os.environ.get("ELASTICSEARCH_URL")
        self.log_reader = MonitoringLogReader(
            log_dir=self.log_dir,
            elasticsearch_url=self.elastic_url,
            index_pattern=os.environ.get("ELASTIC_LOG_INDEX_PATTERN", "akira-service-logs-*"),
        )
        self.monitor_window_minutes = parse_window_minutes(os.environ.get("MONITOR_WINDOW_MINUTES"), 15)
        self.monitor_interval_seconds = int(os.environ.get("MONITOR_INTERVAL_SECONDS", str(self.monitor_window_minutes * 60)))
        self.monitoring_enabled = os.environ.get("MONITORING_SCHEDULER_ENABLED", "true").lower() != "false"
        self.monitor_service_urls = service_urls or {
            "dashboard": os.environ.get("DASHBOARD_URL", "http://127.0.0.1:3000"),
            "storage": os.environ.get("STORAGE_URL", "http://127.0.0.1:9100"),
            "orchestrator": os.environ.get("ORCHESTRATOR_PUBLIC_URL", f"http://127.0.0.1:{os.environ.get('PORT', '9000')}"),
            "agent-runtime": os.environ.get("AGENT_RUNTIME_URL", "http://127.0.0.1:8081"),
        }
        self.monitor_thread: threading.Thread | None = None

    def bootstrap(self):
        try:
            tasks = self.storage.list_tasks()
        except Exception:
            tasks = []
        for task in tasks:
            self.tasks[task["taskId"]] = task
        for task in tasks:
            if task.get("status") == "working":
                self._spawn(task["taskId"], resume=True)
        if self.monitoring_enabled:
            self._spawn_monitor_scheduler()
        self.logger.log(
            "INFO",
            "TaskManager",
            "bootstrap complete",
            context={"taskCount": len(tasks)},
            thread_name="orchestrator.bootstrap",
        )

    def create_task(self, topic: str, task_type: str = "news-podcast") -> dict:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        run_id = f"run_{uuid.uuid4().hex[:8]}"
        task = {
            "taskId": task_id,
            "runId": run_id,
            "type": task_type,
            "topic": topic,
            "status": "submitted",
            "priority": "normal",
            "stageIndex": 0,
            "stage": STAGES[0].name,
            "eventSeq": 0,
            "narrativeSeq": 0,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "artifacts": [],
            "sources": [],
            "rankedSources": [],
            "clusters": [],
            "structure": {},
            "scriptPackage": {},
            "control": {
                "pause": False,
                "interrupt": False,
                "waitingForConfirmation": False,
            },
        }
        self.metrics.inc("akira_tasks_created_total", labels={"type": task_type})
        self._save_task(task)
        self.logger.log(
            "INFO",
            "TaskManager",
            "task created",
            context={"taskId": task_id, "runId": run_id},
            thread_name="orchestrator.control",
        )
        self.emit_machine_event(task, "TASK_STATE_SUBMITTED", 0, "Task created", stage=task["stage"])
        self.emit_narrative_event(task, "Task accepted. Preparing the news-to-podcast workflow.")
        self._spawn(task_id)
        return task

    def create_monitoring_task(self, window_minutes: int, trigger: str) -> dict:
        task_id = f"monitor_{uuid.uuid4().hex[:8]}"
        run_id = f"monitor_run_{uuid.uuid4().hex[:8]}"
        task = {
            "taskId": task_id,
            "runId": run_id,
            "type": "system-monitoring",
            "topic": "system monitoring podcast",
            "status": "working",
            "priority": "normal",
            "stageIndex": 0,
            "stage": "collect_monitoring_inputs",
            "eventSeq": 0,
            "narrativeSeq": 0,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "windowMinutes": window_minutes,
            "trigger": trigger,
            "artifacts": [],
            "control": {
                "pause": False,
                "interrupt": False,
                "waitingForConfirmation": False,
            },
        }
        self._save_task(task)
        return task

    def get_task(self, task_id: str) -> dict | None:
        with self.lock:
            if task_id in self.tasks:
                task = self.tasks[task_id]
            else:
                try:
                    task = self.storage.get_task(task_id)
                    self.tasks[task_id] = task
                except Exception:
                    return None
            try:
                task["artifacts"] = self.storage.list_artifacts(task_id)
            except Exception:
                task["artifacts"] = task.get("artifacts", [])
            return task

    def get_replay(self, task_id: str, from_seq: int = 0) -> list[dict]:
        return self.storage.get_events(task_id, from_seq)

    def list_monitoring_digests(self, limit: int = 10) -> list[dict]:
        try:
            tasks = self.storage.list_tasks()
        except Exception:
            tasks = list(self.tasks.values())
        monitoring_tasks = [
            task for task in tasks
            if task.get("type") == "system-monitoring"
        ]
        monitoring_tasks.sort(key=lambda task: task.get("updatedAt", ""), reverse=True)
        enriched = []
        for task in monitoring_tasks[:limit]:
            try:
                artifacts = self.storage.list_artifacts(task["taskId"])
            except Exception:
                artifacts = []
            enriched.append({
                "task": task,
                "artifacts": artifacts,
            })
        return enriched

    def get_monitoring_overview(self, window_minutes: int | None = None, digest_limit: int = 5) -> dict:
        window_minutes = window_minutes or self.monitor_window_minutes
        health = self._collect_health()
        metrics = self._collect_metrics()
        usage = {
            "current": self.usage_tracker.current(),
            "summary": self.usage_tracker.summary(window_minutes),
            "models": self.usage_tracker.by_model(window_minutes),
            "agents": self.usage_tracker.by_agent(window_minutes),
        }
        digests = self.list_monitoring_digests(digest_limit)
        return {
            "windowMinutes": window_minutes,
            "health": health,
            "metrics": metrics,
            "usage": usage,
            "latestDigests": digests,
            "logSource": "elastic" if self.elastic_url else "local",
        }

    def handle_interrupt(self, task_id: str, action: str, priority: str | None = None) -> dict:
        with self.lock:
            task = self.tasks[task_id]
            if action == "pause":
                task["control"]["pause"] = True
                task["status"] = "paused"
                message = "Paused after the current stage boundary."
                self.metrics.inc("akira_task_controls_total", labels={"action": "pause"})
            elif action == "resume":
                task["control"]["pause"] = False
                if task["status"] != "completed":
                    task["status"] = "working"
                self._spawn(task_id, resume=True)
                message = "Resuming the task."
                self.metrics.inc("akira_task_controls_total", labels={"action": "resume"})
            elif action == "interrupt":
                task["control"]["pause"] = True
                task["status"] = "interrupted"
                message = "Task interrupted and awaiting the next instruction."
                self.metrics.inc("akira_task_controls_total", labels={"action": "interrupt"})
            elif action == "reprioritize":
                task["priority"] = priority or "high"
                message = f"Priority updated to {task['priority']}."
                self.metrics.inc("akira_task_controls_total", labels={"action": "reprioritize"})
            elif action == "summary":
                message = self.summary_text(task)
                self.metrics.inc("akira_task_controls_total", labels={"action": "summary"})
            else:
                raise ValueError("unknown action")
            self._save_task(task)
        self.logger.log(
            "INFO",
            "TaskManager",
            f"task control action={action}",
            context={"taskId": task_id, "runId": task.get("runId"), "action": action},
            thread_name="orchestrator.control",
        )
        self.emit_narrative_event(task, message)
        self.emit_machine_event(task, f"TASK_STATE_{task['status'].upper()}", task_progress(task), message, stage=task["stage"])
        return task

    def handle_confirm(self, task_id: str, approved: bool = True) -> dict:
        task = self.tasks[task_id]
        task["control"]["waitingForConfirmation"] = False
        task["confirmed"] = approved
        self._save_task(task)
        self.metrics.inc("akira_task_controls_total", labels={"action": "confirm"})
        self.emit_narrative_event(task, "Confirmation recorded.")
        return task

    def summary_text(self, task: dict) -> str:
        return (
            f"The task is currently {task['status']} in stage {task['stage']}. "
            f"It has processed {len(task.get('sources', []))} sources and produced "
            f"{len(task.get('artifacts', []))} stored artifacts so far."
        )

    def emit_machine_event(self, task: dict, state: str, progress: int, message: str, stage: str, artifacts=None):
        with self.lock:
            task["eventSeq"] += 1
            event_seq = task["eventSeq"]
            task["updatedAt"] = now_iso()
            self._save_task(task)
        trace_id = uuid.uuid4().hex
        span_id = uuid.uuid4().hex[:16]
        event = {
            "specversion": "1.0",
            "id": f"evt_{task['taskId']}_{event_seq}",
            "source": "urn:idea-workshop:orchestrator",
            "type": "com.idea.platform.machine.v1",
            "subject": f"task/{task['taskId']}",
            "time": now_iso(),
            "traceparent": f"00-{trace_id}-{span_id}-01",
            "tracestate": "listener=edge-local",
            "data": {
                "task_id": task["taskId"],
                "run_id": task["runId"],
                "agent_id": "langgraph_orchestrator",
                "parent_agent_id": "primary_orchestrator",
                "event_seq": event_seq,
                "state": state,
                "progress": progress,
                "total": 100,
                "stage": stage,
                "message": message,
                "audience": "machine",
                "artifacts": artifacts or [],
            },
        }
        self.storage.append_event(event)
        self.logger.log(
            "INFO",
            "TaskManager",
            message,
            context={"traceId": trace_id, "spanId": span_id, "taskId": task["taskId"], "runId": task["runId"]},
            thread_name="orchestrator.workflow",
            thread_number=1,
            stage=stage,
            state=state,
        )
        return event_seq

    def emit_narrative_event(self, task: dict, text: str, derived_from: list[int] | None = None):
        with self.lock:
            task["eventSeq"] += 1
            task["narrativeSeq"] += 1
            event_seq = task["eventSeq"]
            narrative_seq = task["narrativeSeq"]
            self._save_task(task)
        trace_id = uuid.uuid4().hex
        span_id = uuid.uuid4().hex[:16]
        event = {
            "specversion": "1.0",
            "id": f"evt_{task['taskId']}_{event_seq}",
            "source": "urn:idea-workshop:narrator",
            "type": "com.idea.platform.narrative.v1",
            "subject": f"task/{task['taskId']}/narrative",
            "time": now_iso(),
            "data": {
                "task_id": task["taskId"],
                "run_id": task["runId"],
                "event_seq": event_seq,
                "narrative_seq": narrative_seq,
                "state": f"TASK_STATE_{task['status'].upper()}",
                "stage": task["stage"],
                "message": text,
                "audience": "narrative",
                "derived_from": derived_from or [],
            },
        }
        self.storage.append_event(event)
        self.logger.log(
            "INFO",
            "Narrator",
            text,
            context={"traceId": trace_id, "spanId": span_id, "taskId": task["taskId"], "runId": task["runId"]},
            thread_name="orchestrator.narration",
            thread_number=2,
            index_type="akira-monitoring-digests" if task.get("type") == "system-monitoring" else "akira-service-logs",
            stage=task["stage"],
        )
        return event_seq

    def _save_task(self, task: dict):
        task["updatedAt"] = now_iso()
        self.tasks[task["taskId"]] = self.storage.upsert_task(task["taskId"], task)
        return self.tasks[task["taskId"]]

    def _spawn(self, task_id: str, resume: bool = False):
        with self.lock:
            existing = self.threads.get(task_id)
            if existing and existing.is_alive():
                return
            thread = threading.Thread(
                target=self._run_task,
                args=(task_id, resume),
                daemon=True,
                name=f"workflow:{task_id}",
            )
            self.threads[task_id] = thread
            thread.start()

    def _spawn_monitor_scheduler(self):
        if self.monitor_thread and self.monitor_thread.is_alive():
            return

        def scheduler():
            while True:
                time.sleep(self.monitor_interval_seconds)
                try:
                    self.generate_monitoring_digest(trigger="scheduled", window_minutes=self.monitor_window_minutes)
                except Exception as error:
                    self.logger.log(
                        "ERROR",
                        "MonitoringScheduler",
                        f"scheduled monitoring digest failed: {error}",
                        thread_name="orchestrator.monitoring",
                        thread_number=3,
                    )

        self.monitor_thread = threading.Thread(target=scheduler, daemon=True, name="monitoring-scheduler")
        self.monitor_thread.start()

    def _wait_if_paused(self, task: dict):
        while task["control"].get("pause"):
            self._save_task(task)
            time.sleep(0.4)
            refreshed = self.storage.get_task(task["taskId"])
            task.update(refreshed)

    def _record_usage(self, *, model: str, agent_id: str, prompt_tokens: int, completion_tokens: int, cost_usd: float, task: dict):
        self.usage_tracker.record_call(
            model=model,
            agent_id=agent_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            task_id=task.get("taskId"),
            run_id=task.get("runId"),
        )
        self.metrics.inc("akira_model_requests_total", labels={"model": model, "agent": agent_id})

    def _run_task(self, task_id: str, resume: bool = False):
        task = self.tasks[task_id]
        if task["status"] not in {"completed", "failed"}:
            task["status"] = "working" if not task["control"].get("pause") else task["status"]
            self._save_task(task)

        try:
            start_index = int(task.get("stageIndex", 0))
            if resume and start_index > 0:
                self.emit_narrative_event(task, "Recovered the task from persisted state and resumed execution.")

            for index in range(start_index, len(STAGES)):
                task = self.storage.get_task(task_id)
                self.tasks[task_id] = task
                if task["control"].get("pause"):
                    self._wait_if_paused(task)
                stage = STAGES[index]
                task["stage"] = stage.name
                self._save_task(task)
                self.emit_machine_event(
                    task,
                    "TASK_STATE_WORKING",
                    stage.progress,
                    f"Entering stage {stage.name}",
                    stage.name,
                )

                if stage.name == "accept_request":
                    self.emit_narrative_event(task, f"Starting work on the topic '{task['topic']}'.")

                elif stage.name == "retrieve_sources":
                    result = self.mcp.search_news(task["topic"], limit=6)
                    sources = self.workers.execute(stage.role, {"sources": result["articles"]})["sources"]
                    task["sources"] = sources
                    self.storage.upsert_vectors(
                        task["taskId"],
                        [
                            {
                                "id": source["id"],
                                "text": f"{source['title']} {source['snippet']}",
                                "metadata": {"url": source["url"], "source": source["source"]},
                            }
                            for source in sources
                        ],
                    )
                    self.emit_narrative_event(task, f"Retrieved {len(sources)} candidate sources.")

                elif stage.name == "normalize_dedupe":
                    normalized = self.workers.execute(stage.role, {"sources": task["sources"]})
                    task["sources"] = normalized["sources"]
                    self.emit_narrative_event(task, f"Normalized and deduplicated to {len(task['sources'])} sources.")

                elif stage.name == "rank_cluster":
                    ranked = self.workers.execute(stage.role, {"sources": task["sources"]})
                    task["rankedSources"] = ranked["ranked"]
                    task["clusters"] = ranked["clusters"]
                    self.emit_narrative_event(task, "Ranked the sources and grouped them into themes.")

                elif stage.name == "draft_structure":
                    structure = self.workers.execute(
                        stage.role,
                        {"topic": task["topic"], "ranked": task["rankedSources"]},
                    )
                    task["structure"] = structure
                    self._record_usage(
                        model="gpt-4.1-mini",
                        agent_id="draft_structure",
                        prompt_tokens=280,
                        completion_tokens=120,
                        cost_usd=0.0024,
                        task=task,
                    )
                    self.emit_narrative_event(task, "Built the episode structure and title options.")

                elif stage.name == "generate_script":
                    script = self.workers.execute(
                        stage.role,
                        {
                            "topic": task["topic"],
                            "structure": task["structure"],
                            "ranked": task["rankedSources"],
                        },
                    )
                    task["scriptPackage"] = script
                    self._record_usage(
                        model="gpt-4.1",
                        agent_id="draft_script",
                        prompt_tokens=920,
                        completion_tokens=640,
                        cost_usd=0.0182,
                        task=task,
                    )
                    self.emit_narrative_event(task, "Drafted the sourced script package.")

                elif stage.name == "validate_citations":
                    validated = self.workers.execute(
                        stage.role,
                        {"script": task["scriptPackage"], "sources": task["sources"]},
                    )
                    task["scriptPackage"] = validated
                    self._record_usage(
                        model="gpt-4.1-mini",
                        agent_id="citation_validator",
                        prompt_tokens=420,
                        completion_tokens=140,
                        cost_usd=0.0031,
                        task=task,
                    )
                    self.emit_narrative_event(task, "Validated citation coverage and removed any unsupported lines.")

                elif stage.name == "publish_artifact_package":
                    show_notes = self.workers.execute(stage.role, {"sources": task["sources"]})
                    artifact = {
                        "type": "script-package",
                        "topic": task["topic"],
                        "summary": task["scriptPackage"]["summary"],
                        "episodeTitle": task["scriptPackage"]["episodeTitle"],
                        "showNotes": show_notes["showNotes"],
                        "scriptSections": task["scriptPackage"]["scriptSections"],
                        "sources": task["sources"],
                        "clusters": task["clusters"],
                        "generatedAt": now_iso(),
                    }
                    saved = self.storage.save_artifact(task["taskId"], "script-package", artifact)
                    task["artifacts"] = [saved]
                    self.emit_narrative_event(task, "Published the script package artifact.")
                    self.emit_machine_event(
                        task,
                        "TASK_STATE_WORKING",
                        stage.progress,
                        "Artifact package stored",
                        stage.name,
                        artifacts=[saved],
                    )

                task["stageIndex"] = index + 1
                self._save_task(task)
                time.sleep(0.6)

            task["status"] = "completed"
            self._save_task(task)
            self.metrics.inc("akira_tasks_completed_total", labels={"type": task.get("type", "news-podcast")})
            self.emit_machine_event(task, "TASK_STATE_COMPLETED", 100, "Task completed", task["stage"])
            self.emit_narrative_event(task, "The podcast digest package is ready for review.")
        except Exception as error:
            task["status"] = "failed"
            task["error"] = str(error)
            self._save_task(task)
            self.metrics.inc("akira_tasks_failed_total", labels={"type": task.get("type", "news-podcast")})
            self.emit_machine_event(task, "TASK_STATE_FAILED", task_progress(task), str(error), task["stage"])
            self.emit_narrative_event(task, f"The task failed: {error}")

    def _fetch_json(self, url: str) -> dict:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _fetch_text(self, url: str) -> str:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.read().decode("utf-8")

    def _collect_health(self) -> dict:
        results = {}
        for service_name, base_url in self.monitor_service_urls.items():
            try:
                payload = self._fetch_json(f"{base_url.rstrip('/')}/health")
                results[service_name] = {"ok": bool(payload.get("ok", True)), "payload": payload}
            except Exception as error:
                results[service_name] = {"ok": False, "error": str(error)}
        return results

    def _parse_prometheus_metrics(self, text: str) -> dict[str, float]:
        parsed: dict[str, float] = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                name_and_labels, value = stripped.rsplit(" ", 1)
                metric_name = name_and_labels.split("{", 1)[0]
                parsed[metric_name] = parsed.get(metric_name, 0.0) + float(value)
            except ValueError:
                continue
        return parsed

    def _collect_metrics(self) -> dict:
        results = {}
        for service_name, base_url in self.monitor_service_urls.items():
            try:
                payload = self._fetch_text(f"{base_url.rstrip('/')}/metrics")
                parsed = self._parse_prometheus_metrics(payload)
                results[service_name] = {
                    "ok": True,
                    "residentMemoryKb": parsed.get("process_resident_memory_kilobytes", 0.0),
                    "heapUsedBytes": parsed.get("process_heap_used_bytes", 0.0),
                    "requestCount": parsed.get("akira_http_requests_total", 0.0),
                    "errorCount": parsed.get("akira_http_errors_total", 0.0),
                    "raw": parsed,
                }
            except Exception as error:
                results[service_name] = {"ok": False, "error": str(error), "raw": {}}
        return results

    def _read_monitoring_logs(self, start_time: datetime, end_time: datetime) -> tuple[str, list[dict]]:
        return self.log_reader.read(start_time, end_time)

    def generate_monitoring_digest(self, *, trigger: str = "manual", window_minutes: int | None = None) -> dict:
        window_minutes = window_minutes or self.monitor_window_minutes
        end_time = utc_now()
        start_time = end_time - timedelta(minutes=window_minutes)
        task = self.create_monitoring_task(window_minutes, trigger)
        self.emit_machine_event(task, "TASK_STATE_WORKING", 10, "Collecting monitoring inputs", "collect_monitoring_inputs")

        health = self._collect_health()
        metrics = self._collect_metrics()
        usage = {
            "current": self.usage_tracker.current(),
            "summary": self.usage_tracker.summary(window_minutes),
            "models": self.usage_tracker.by_model(window_minutes),
            "agents": self.usage_tracker.by_agent(window_minutes),
        }
        log_source, logs = self._read_monitoring_logs(start_time, end_time)
        unhealthy_services = [name for name, payload in health.items() if not payload.get("ok")]
        noisy_services = sorted(
            [
                (name, int(payload.get("errorCount", 0)))
                for name, payload in metrics.items()
                if payload.get("errorCount", 0) > 0
            ],
            key=lambda item: item[1],
            reverse=True,
        )
        memory_hotspots = sorted(
            [
                (name, int(payload.get("residentMemoryKb", 0)))
                for name, payload in metrics.items()
            ],
            key=lambda item: item[1],
            reverse=True,
        )
        incidents = []
        if unhealthy_services:
            incidents.append({
                "severity": "high",
                "title": "Service health degradation detected",
                "services": unhealthy_services,
            })
        if noisy_services:
            incidents.append({
                "severity": "medium",
                "title": "Error-producing services in this window",
                "services": noisy_services[:3],
            })
        headline = (
            f"System monitoring window closed with {len(unhealthy_services)} unhealthy services, "
            f"{usage['summary']['requestCount']} model calls, and {len(logs)} structured log records."
        )
        top_memory = memory_hotspots[0] if memory_hotspots else ("unknown", 0)
        script = "\n".join([
            "System monitoring podcast update.",
            headline,
            f"Log source for this window was {log_source}.",
            f"Top memory pressure came from {top_memory[0]} at about {top_memory[1]} kilobytes resident memory.",
            f"Model usage totaled {usage['summary']['totalTokens']} tokens across {usage['summary']['requestCount']} requests.",
            "Health summary follows.",
            *(f"{service}: {'healthy' if payload.get('ok') else 'degraded'}." for service, payload in health.items()),
        ])
        ssml = f"<speak><prosody rate=\"medium\">{script}</prosody></speak>"
        audio = render_audio_payload(script, ssml)
        artifact = {
            "type": "monitoring-podcast",
            "digestId": f"digest_{uuid.uuid4().hex[:10]}",
            "window": {
                "start": start_time.isoformat(),
                "end": end_time.isoformat(),
            },
            "headline": headline,
            "healthSummary": health,
            "memorySummary": {
                "topServices": memory_hotspots[:5],
            },
            "modelUsageSummary": usage,
            "incidents": incidents,
            "logSummary": {
                "source": log_source,
                "recordCount": len(logs),
                "levels": {
                    "ERROR": len([record for record in logs if record.get("logLevel") == "ERROR"]),
                    "INFO": len([record for record in logs if record.get("logLevel") == "INFO"]),
                },
            },
            "script": script,
            "audio": audio,
            "generatedAt": now_iso(),
            "trigger": trigger,
        }
        saved = self.storage.save_artifact(task["taskId"], "monitoring-podcast", artifact)
        task["artifacts"] = [saved]
        task["status"] = "completed"
        task["stage"] = "publish_monitoring_digest"
        task["stageIndex"] = 1
        self._save_task(task)
        self.metrics.inc("akira_monitoring_digest_runs_total", labels={"trigger": trigger})
        self._record_usage(
            model="gpt-4.1-mini",
            agent_id="system-monitoring-podcast",
            prompt_tokens=560,
            completion_tokens=320,
            cost_usd=0.0044,
            task=task,
        )
        self.logger.log(
            "INFO",
            "MonitoringDigest",
            "monitoring digest generated",
            context={"taskId": task["taskId"], "runId": task["runId"]},
            thread_name="orchestrator.monitoring",
            thread_number=3,
            index_type="akira-monitoring-digests",
            digestId=artifact["digestId"],
        )
        self.emit_narrative_event(task, "Generated the system monitoring podcast digest for the latest window.")
        self.emit_machine_event(task, "TASK_STATE_COMPLETED", 100, "Monitoring digest stored", task["stage"], artifacts=[saved])
        return {"task": task, "artifact": saved}


class OrchestratorHandler(BaseHTTPRequestHandler):
    manager: TaskManager = None  # type: ignore[assignment]

    def _trace_context(self) -> tuple[str, str]:
        trace_id = self.headers.get("x-trace-id", uuid.uuid4().hex)
        span_id = uuid.uuid4().hex[:16]
        return trace_id, span_id

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _text(self, status: int, payload: str, content_type: str = "text/plain; charset=utf-8"):
        body = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _record_request(self, route: str, method: str):
        self.manager.metrics.inc("akira_http_requests_total", labels={"service": "orchestrator", "method": method, "route": route})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type,x-trace-id")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        trace_id, span_id = self._trace_context()
        self._record_request(parsed.path, "GET")
        try:
            if parsed.path == "/health":
                active_tasks = len([task for task in self.manager.tasks.values() if task.get("status") == "working"])
                self.manager.logger.log(
                    "INFO",
                    "HTTP",
                    "health requested",
                    context={"traceId": trace_id, "spanId": span_id},
                    thread_name="orchestrator.http",
                    thread_number=10,
                )
                return self._json(200, {"ok": True, "service": "orchestrator", "activeTasks": active_tasks})

            if parsed.path == "/metrics":
                active_tasks = len([task for task in self.manager.tasks.values() if task.get("status") == "working"])
                self.manager.metrics.set_gauge("akira_active_tasks", active_tasks, labels={"service": "orchestrator"})
                return self._text(200, self.manager.metrics.render())

            if parsed.path == "/v1/usage/current":
                return self._json(200, self.manager.usage_tracker.current())

            if parsed.path == "/v1/usage/summary":
                query = parse_qs(parsed.query)
                window = parse_window_minutes(query.get("window", [None])[0], self.manager.monitor_window_minutes)
                return self._json(200, self.manager.usage_tracker.summary(window))

            if parsed.path == "/v1/usage/models":
                query = parse_qs(parsed.query)
                window = parse_window_minutes(query.get("window", [None])[0], self.manager.monitor_window_minutes)
                return self._json(200, self.manager.usage_tracker.by_model(window))

            if parsed.path == "/v1/usage/agents":
                query = parse_qs(parsed.query)
                window = parse_window_minutes(query.get("window", [None])[0], self.manager.monitor_window_minutes)
                return self._json(200, self.manager.usage_tracker.by_agent(window))

            if parsed.path == "/v1/monitoring/digests":
                query = parse_qs(parsed.query)
                limit = int(query.get("limit", ["10"])[0])
                return self._json(200, {"items": self.manager.list_monitoring_digests(limit)})

            if parsed.path == "/v1/monitoring/overview":
                query = parse_qs(parsed.query)
                limit = int(query.get("limit", ["5"])[0])
                window = parse_window_minutes(query.get("window", [None])[0], self.manager.monitor_window_minutes)
                return self._json(200, self.manager.get_monitoring_overview(window, limit))

            if parsed.path.startswith("/v1/tasks/") and parsed.path.endswith("/status"):
                task_id = parsed.path.split("/")[3]
                task = self.manager.get_task(task_id)
                if not task:
                    return self._json(404, {"error": "task not found"})
                return self._json(
                    200,
                    {
                        "taskId": task["taskId"],
                        "runId": task["runId"],
                        "status": task["status"],
                        "stage": task["stage"],
                        "priority": task["priority"],
                        "progress": task_progress(task),
                        "artifactCount": len(task.get("artifacts", [])),
                        "type": task.get("type", "news-podcast"),
                    },
                )

            if parsed.path.startswith("/v1/tasks/") and parsed.path.endswith("/replay"):
                task_id = parsed.path.split("/")[3]
                query = parse_qs(parsed.query)
                from_seq = int(query.get("from", ["0"])[0])
                return self._json(200, {"taskId": task_id, "events": self.manager.get_replay(task_id, from_seq)})

            if parsed.path.startswith("/v1/tasks/") and parsed.path.endswith("/events"):
                task_id = parsed.path.split("/")[3]
                query = parse_qs(parsed.query)
                from_seq = int(query.get("fromSeq", ["0"])[0])
                last_header = self.headers.get("last-event-id")
                if last_header and last_header.isdigit():
                    from_seq = max(from_seq, int(last_header) + 1)
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-cache")
                self.send_header("connection", "keep-alive")
                self.send_header("access-control-allow-origin", "*")
                self.end_headers()
                last_seq = from_seq
                try:
                    while True:
                        events = self.manager.get_replay(task_id, last_seq)
                        if events:
                            for event in events:
                                event_seq = int(event["data"]["event_seq"])
                                payload = json.dumps(event)
                                frame = f"id: {event_seq}\nevent: {event['data']['audience']}\ndata: {payload}\n\n"
                                self.wfile.write(frame.encode("utf-8"))
                                self.wfile.flush()
                                last_seq = event_seq + 1
                        else:
                            self.wfile.write(b": heartbeat\n\n")
                            self.wfile.flush()
                        time.sleep(1)
                except (BrokenPipeError, ConnectionResetError):
                    return

            if parsed.path.startswith("/v1/tasks/"):
                task_id = parsed.path.split("/")[3]
                task = self.manager.get_task(task_id)
                if not task:
                    return self._json(404, {"error": "task not found"})
                return self._json(200, task)

            return self._json(404, {"error": "not found"})
        except Exception as error:
            self.manager.metrics.inc("akira_http_errors_total", labels={"service": "orchestrator", "method": "GET", "route": parsed.path})
            self.manager.logger.log(
                "ERROR",
                "HTTP",
                f"GET {parsed.path} failed: {error}",
                context={"traceId": trace_id, "spanId": span_id},
                thread_name="orchestrator.http",
                thread_number=10,
            )
            return self._json(500, {"error": str(error)})

    def do_POST(self):
        parsed = urlparse(self.path)
        trace_id, span_id = self._trace_context()
        self._record_request(parsed.path, "POST")
        try:
            if parsed.path == "/v1/tasks":
                body = self._read_json()
                topic = body.get("topic", "").strip()
                if not topic:
                    return self._json(400, {"error": "topic is required"})
                task = self.manager.create_task(topic)
                return self._json(201, task)

            if parsed.path == "/v1/monitoring/digests/run":
                body = self._read_json()
                window_minutes = int(body.get("windowMinutes", self.manager.monitor_window_minutes))
                result = self.manager.generate_monitoring_digest(trigger="manual", window_minutes=window_minutes)
                return self._json(201, result)

            if parsed.path.startswith("/v1/tasks/") and parsed.path.endswith("/interrupt"):
                task_id = parsed.path.split("/")[3]
                body = self._read_json()
                action = body.get("action", "interrupt")
                priority = body.get("priority")
                try:
                    task = self.manager.handle_interrupt(task_id, action, priority)
                except Exception as error:
                    return self._json(400, {"error": str(error)})
                return self._json(200, task)

            if parsed.path.startswith("/v1/tasks/") and parsed.path.endswith("/confirm"):
                task_id = parsed.path.split("/")[3]
                body = self._read_json()
                task = self.manager.handle_confirm(task_id, body.get("approved", True))
                return self._json(200, task)

            return self._json(404, {"error": "not found"})
        except Exception as error:
            self.manager.metrics.inc("akira_http_errors_total", labels={"service": "orchestrator", "method": "POST", "route": parsed.path})
            self.manager.logger.log(
                "ERROR",
                "HTTP",
                f"POST {parsed.path} failed: {error}",
                context={"traceId": trace_id, "spanId": span_id},
                thread_name="orchestrator.http",
                thread_number=10,
            )
            return self._json(500, {"error": str(error)})


def main():
    port = int(os.environ.get("PORT", "9000"))
    logger = StructuredLogger("orchestrator")
    metrics = MetricsRegistry("orchestrator")
    usage_tracker = UsageTracker()
    storage = StorageClient(os.environ.get("STORAGE_URL", "http://127.0.0.1:9100"))
    mcp = MCPClient(os.environ.get("MCP_SERVER_URL"))
    workers = WorkerClient(os.environ.get("AGENT_RUNTIME_URL"))
    manager = TaskManager(
        storage,
        mcp,
        workers,
        logger=logger,
        metrics=metrics,
        usage_tracker=usage_tracker,
    )
    manager.bootstrap()
    OrchestratorHandler.manager = manager
    server = ThreadingHTTPServer(("0.0.0.0", port), OrchestratorHandler)
    logger.log(
        "INFO",
        "Server",
        f"orchestrator listening on http://127.0.0.1:{port}",
        thread_name="orchestrator.main",
        thread_number=0,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
