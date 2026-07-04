import json
import urllib.error
import urllib.parse
import urllib.request


class StorageClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, payload=None):
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def health(self):
        return self._request("GET", "/health")

    def capabilities(self):
        return self._request("GET", "/v1/capabilities")

    def list_tasks(self):
        return self._request("GET", "/v1/tasks")["tasks"]

    def get_task(self, task_id: str):
        return self._request("GET", f"/v1/tasks/{urllib.parse.quote(task_id)}")

    def upsert_task(self, task_id: str, task: dict):
        return self._request("PUT", f"/v1/tasks/{urllib.parse.quote(task_id)}", task)

    def append_event(self, event: dict):
        return self._request("POST", "/v1/events", event)

    def get_events(self, task_id: str, from_seq: int = 0):
        query = urllib.parse.urlencode({"taskId": task_id, "fromSeq": from_seq})
        return self._request("GET", f"/v1/events?{query}")["events"]

    def save_artifact(self, task_id: str, artifact_id: str, artifact: dict):
        return self._request(
            "PUT",
            f"/v1/artifacts/{urllib.parse.quote(task_id)}/{urllib.parse.quote(artifact_id)}",
            artifact,
        )

    def list_artifacts(self, task_id: str):
        return self._request("GET", f"/v1/artifacts/{urllib.parse.quote(task_id)}")["artifacts"]

    def upsert_vectors(self, namespace: str, items: list[dict]):
        return self._request("POST", "/v1/vector/upsert", {"namespace": namespace, "items": items})

    def query_vectors(self, namespace: str, query: str, limit: int = 5):
        return self._request(
            "POST",
            "/v1/vector/query",
            {"namespace": namespace, "query": query, "limit": limit},
        )

    def delete_vectors(self, namespace: str, ids: list[str] | None = None):
        return self._request(
            "POST",
            "/v1/vector/delete",
            {"namespace": namespace, "ids": ids or []},
        )

    def purge(self, task_id: str, include: dict):
        return self._request("POST", "/v1/purge", {"taskId": task_id, "include": include})

