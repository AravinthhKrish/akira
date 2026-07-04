from __future__ import annotations

import json
import urllib.request
from datetime import datetime
from pathlib import Path


class MonitoringLogReader:
    def __init__(
        self,
        *,
        log_dir: str | Path,
        elasticsearch_url: str | None = None,
        index_pattern: str = "akira-service-logs-*",
    ):
        self.log_dir = Path(log_dir)
        self.elasticsearch_url = elasticsearch_url.rstrip("/") if elasticsearch_url else None
        self.index_pattern = index_pattern

    def _read_local(self, start_time: datetime, end_time: datetime) -> list[dict]:
        records = []
        if not self.log_dir.exists():
            return records
        for file_path in sorted(self.log_dir.glob("*.jsonl")):
            try:
                for line in file_path.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    ts = datetime.fromisoformat(record["dateTime"])
                    if start_time <= ts <= end_time:
                        records.append(record)
            except Exception:
                continue
        return records

    def _read_elastic(self, start_time: datetime, end_time: datetime) -> list[dict]:
        query = {
            "size": 500,
            "sort": [{"dateTime": {"order": "asc"}}],
            "query": {
                "bool": {
                    "filter": [
                        {"range": {"dateTime": {"gte": start_time.isoformat(), "lte": end_time.isoformat()}}},
                    ]
                }
            },
        }
        request = urllib.request.Request(
            f"{self.elasticsearch_url}/{self.index_pattern}/_search",
            data=json.dumps(query).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        hits = payload.get("hits", {}).get("hits", [])
        return [hit.get("_source", {}) for hit in hits]

    def read(self, start_time: datetime, end_time: datetime) -> tuple[str, list[dict]]:
        if self.elasticsearch_url:
            try:
                return "elastic", self._read_elastic(start_time, end_time)
            except Exception:
                pass
        return "local", self._read_local(start_time, end_time)
