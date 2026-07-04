from __future__ import annotations

import json
import os
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from resource import RUSAGE_SELF, getrusage


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return utc_now().isoformat()


def _escape_label(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


class StructuredLogger:
    def __init__(self, service_name: str, log_dir: str | None = None, environment: str | None = None):
        self.service_name = service_name
        self.environment = environment or os.environ.get("APP_ENV", "local")
        self.log_dir = Path(log_dir or os.environ.get("OBSERVABILITY_LOG_DIR", "data/observability/logs"))
        self.lock = threading.Lock()

    def _write_local(self, record: dict):
        self.log_dir.mkdir(parents=True, exist_ok=True)
        with (self.log_dir / f"{self.service_name}.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")

    def log(
        self,
        log_level: str,
        class_name: str,
        message: str,
        context: dict | None = None,
        thread_name: str | None = None,
        thread_number: int | None = None,
        index_type: str = "akira-service-logs",
        **extra,
    ) -> dict:
        current_thread = threading.current_thread()
        context_payload = {
            "traceId": uuid.uuid4().hex,
            "spanId": uuid.uuid4().hex[:16],
            **(context or {}),
        }
        record = {
            "dateTime": now_iso(),
            "serviceName": self.service_name,
            "logLevel": log_level,
            "threadName": thread_name or current_thread.name,
            "threadNumber": int(thread_number if thread_number is not None else (current_thread.ident or 0)),
            "className": class_name,
            "message": message,
            "indexType": index_type,
            "environment": self.environment,
            "context": context_payload,
            **extra,
        }
        print(json.dumps(record), flush=True)
        with self.lock:
            try:
                self._write_local(record)
            except Exception:
                pass
        return record


class MetricsRegistry:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.started_at = utc_now()
        self.counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self.gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self.lock = threading.Lock()

    def _key(self, name: str, labels: dict | None = None):
        normalized = tuple(sorted((labels or {}).items()))
        return name, normalized

    def inc(self, name: str, value: float = 1.0, labels: dict | None = None):
        with self.lock:
            key = self._key(name, labels)
            self.counters[key] = self.counters.get(key, 0.0) + value

    def set_gauge(self, name: str, value: float, labels: dict | None = None):
        with self.lock:
            self.gauges[self._key(name, labels)] = value

    def render(self, extra_metrics: dict[str, float] | None = None) -> str:
        extra_metrics = extra_metrics or {}
        usage = getrusage(RUSAGE_SELF)
        lines = [
            f'process_resident_memory_kilobytes{{service="{self.service_name}"}} {usage.ru_maxrss}',
            f'process_user_cpu_seconds_total{{service="{self.service_name}"}} {usage.ru_utime:.6f}',
            f'process_system_cpu_seconds_total{{service="{self.service_name}"}} {usage.ru_stime:.6f}',
            f'service_uptime_seconds{{service="{self.service_name}"}} {(utc_now() - self.started_at).total_seconds():.0f}',
        ]
        with self.lock:
            for (name, labels), value in sorted(self.counters.items()):
                label_str = ",".join(f'{key}="{_escape_label(val)}"' for key, val in labels)
                wrapped = f"{name}{{{label_str}}}" if label_str else name
                lines.append(f"{wrapped} {value}")
            for (name, labels), value in sorted(self.gauges.items()):
                label_str = ",".join(f'{key}="{_escape_label(val)}"' for key, val in labels)
                wrapped = f"{name}{{{label_str}}}" if label_str else name
                lines.append(f"{wrapped} {value}")
        for name, value in extra_metrics.items():
            lines.append(f"{name} {value}")
        return "\n".join(lines) + "\n"


@dataclass
class UsageRecord:
    recorded_at: datetime
    model: str
    agent_id: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    status: str
    task_id: str | None
    run_id: str | None


class UsageTracker:
    def __init__(self):
        self.lock = threading.Lock()
        self.records: list[UsageRecord] = []
        self.in_flight = 0

    def record_call(
        self,
        *,
        model: str,
        agent_id: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        status: str = "success",
        task_id: str | None = None,
        run_id: str | None = None,
    ):
        with self.lock:
            self.records.append(
                UsageRecord(
                    recorded_at=utc_now(),
                    model=model,
                    agent_id=agent_id,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_usd=cost_usd,
                    status=status,
                    task_id=task_id,
                    run_id=run_id,
                )
            )

    def _filter(self, window_minutes: int | None = None) -> list[UsageRecord]:
        with self.lock:
            records = list(self.records)
        if window_minutes is None:
            return records
        cutoff = utc_now() - timedelta(minutes=window_minutes)
        return [record for record in records if record.recorded_at >= cutoff]

    def current(self) -> dict:
        records = self._filter(window_minutes=15)
        return {
            "inFlight": self.in_flight,
            "windowMinutes": 15,
            "requestCount": len(records),
            "promptTokens": sum(record.prompt_tokens for record in records),
            "completionTokens": sum(record.completion_tokens for record in records),
            "costUsd": round(sum(record.cost_usd for record in records), 6),
        }

    def summary(self, window_minutes: int = 15) -> dict:
        records = self._filter(window_minutes)
        errors = [record for record in records if record.status != "success"]
        return {
            "windowMinutes": window_minutes,
            "requestCount": len(records),
            "errorCount": len(errors),
            "promptTokens": sum(record.prompt_tokens for record in records),
            "completionTokens": sum(record.completion_tokens for record in records),
            "totalTokens": sum(record.prompt_tokens + record.completion_tokens for record in records),
            "costUsd": round(sum(record.cost_usd for record in records), 6),
            "models": sorted({record.model for record in records}),
            "agents": sorted({record.agent_id for record in records}),
        }

    def by_model(self, window_minutes: int = 15) -> dict:
        groups: dict[str, dict] = defaultdict(lambda: {
            "requestCount": 0,
            "promptTokens": 0,
            "completionTokens": 0,
            "costUsd": 0.0,
            "errorCount": 0,
        })
        for record in self._filter(window_minutes):
            bucket = groups[record.model]
            bucket["requestCount"] += 1
            bucket["promptTokens"] += record.prompt_tokens
            bucket["completionTokens"] += record.completion_tokens
            bucket["costUsd"] += record.cost_usd
            if record.status != "success":
                bucket["errorCount"] += 1
        return {"windowMinutes": window_minutes, "models": groups}

    def by_agent(self, window_minutes: int = 15) -> dict:
        groups: dict[str, dict] = defaultdict(lambda: {
            "requestCount": 0,
            "promptTokens": 0,
            "completionTokens": 0,
            "costUsd": 0.0,
            "errorCount": 0,
        })
        for record in self._filter(window_minutes):
            bucket = groups[record.agent_id]
            bucket["requestCount"] += 1
            bucket["promptTokens"] += record.prompt_tokens
            bucket["completionTokens"] += record.completion_tokens
            bucket["costUsd"] += record.cost_usd
            if record.status != "success":
                bucket["errorCount"] += 1
        return {"windowMinutes": window_minutes, "agents": groups}
