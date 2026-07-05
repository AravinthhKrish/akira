from __future__ import annotations

import base64
import json
import os
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


def _load_json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _clean_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(val) for key, val in value.items() if str(val).strip()}


@dataclass
class ModelRouterConfig:
    url: str | None = None
    auth_mode: str = "none"
    auth_header_name: str = "Authorization"
    bearer_token: str | None = None
    basic_username: str | None = None
    basic_password: str | None = None
    header_value: str | None = None
    default_model: str = "gpt-4.1-mini"
    role_models: dict[str, str] = field(default_factory=dict)
    stage_models: dict[str, str] = field(default_factory=dict)
    task_type_models: dict[str, str] = field(default_factory=dict)
    timeout_seconds: int = 15
    source: str = "env"

    @classmethod
    def from_env(cls) -> "ModelRouterConfig":
        return cls(
            url=ModelRouter._normalize_url(None, os.environ.get("MODEL_ROUTER_URL")),
            auth_mode=os.environ.get("MODEL_ROUTER_AUTH_MODE", "none").strip().lower(),
            auth_header_name=os.environ.get("MODEL_ROUTER_AUTH_HEADER_NAME", "Authorization"),
            bearer_token=os.environ.get("MODEL_ROUTER_BEARER_TOKEN"),
            basic_username=os.environ.get("MODEL_ROUTER_BASIC_USERNAME"),
            basic_password=os.environ.get("MODEL_ROUTER_BASIC_PASSWORD"),
            header_value=os.environ.get("MODEL_ROUTER_HEADER_VALUE"),
            default_model=os.environ.get("MODEL_ROUTER_DEFAULT_MODEL", "gpt-4.1-mini"),
            role_models=_clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_ROLE_MODELS_JSON"))),
            stage_models=_clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_STAGE_MODELS_JSON"))),
            task_type_models=_clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_TASK_TYPE_MODELS_JSON"))),
            timeout_seconds=max(1, int(os.environ.get("MODEL_ROUTER_TIMEOUT_SECONDS", "15"))),
            source="env",
        )

    def copy(self) -> "ModelRouterConfig":
        return ModelRouterConfig(
            url=self.url,
            auth_mode=self.auth_mode,
            auth_header_name=self.auth_header_name,
            bearer_token=self.bearer_token,
            basic_username=self.basic_username,
            basic_password=self.basic_password,
            header_value=self.header_value,
            default_model=self.default_model,
            role_models=dict(self.role_models),
            stage_models=dict(self.stage_models),
            task_type_models=dict(self.task_type_models),
            timeout_seconds=self.timeout_seconds,
            source=self.source,
        )

    def apply_patch(self, payload: dict[str, Any]) -> "ModelRouterConfig":
        next_config = self.copy()
        if "url" in payload:
            next_config.url = ModelRouter._normalize_url(next_config.url, payload.get("url"))
        if "authMode" in payload:
            next_config.auth_mode = str(payload.get("authMode") or "none").strip().lower()
        if "authHeaderName" in payload:
            next_config.auth_header_name = str(payload.get("authHeaderName") or "Authorization")
        if "defaultModel" in payload:
            next_config.default_model = str(payload.get("defaultModel") or next_config.default_model)
        if "timeoutSeconds" in payload:
            next_config.timeout_seconds = max(1, int(payload.get("timeoutSeconds") or next_config.timeout_seconds))
        if "roleModels" in payload:
            next_config.role_models = _clean_map(payload.get("roleModels"))
        if "stageModels" in payload:
            next_config.stage_models = _clean_map(payload.get("stageModels"))
        if "taskTypeModels" in payload:
            next_config.task_type_models = _clean_map(payload.get("taskTypeModels"))
        credentials = payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {}
        merged = {**credentials}
        for key in ("bearerToken", "basicUsername", "basicPassword", "headerValue"):
            if key in payload:
                merged[key] = payload.get(key)
        if "bearerToken" in merged:
            next_config.bearer_token = merged.get("bearerToken")
        if "basicUsername" in merged:
            next_config.basic_username = merged.get("basicUsername")
        if "basicPassword" in merged:
            next_config.basic_password = merged.get("basicPassword")
        if "headerValue" in merged:
            next_config.header_value = merged.get("headerValue")
        next_config.source = "runtime"
        return next_config

    def public_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "authMode": self.auth_mode,
            "authHeaderName": self.auth_header_name,
            "defaultModel": self.default_model,
            "timeoutSeconds": self.timeout_seconds,
            "roleModels": dict(self.role_models),
            "stageModels": dict(self.stage_models),
            "taskTypeModels": dict(self.task_type_models),
            "credentials": {
                "hasBearerToken": bool(self.bearer_token),
                "hasBasicCredentials": bool(self.basic_username and self.basic_password),
                "hasHeaderValue": bool(self.header_value),
            },
            "source": self.source,
        }


class ModelRouter:
    def __init__(self, config: ModelRouterConfig | None = None):
        self.lock = threading.RLock()
        self.config = config or ModelRouterConfig.from_env()

    @staticmethod
    def _normalize_url(previous: str | None, value: Any) -> str | None:
        if value is None:
            return previous
        normalized = str(value).strip()
        return normalized or None

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return self.config.public_dict()

    def update(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.config = self.config.apply_patch(payload)
            return self.config.public_dict()

    def _auth_headers(self, config: ModelRouterConfig) -> dict[str, str]:
        mode = config.auth_mode.lower()
        if mode == "none":
            return {}
        if mode == "bearer":
            token = config.bearer_token or config.header_value
            if not token:
                return {}
            return {"Authorization": f"Bearer {token}"}
        if mode == "basic":
            if not config.basic_username or not config.basic_password:
                return {}
            raw = f"{config.basic_username}:{config.basic_password}".encode("utf-8")
            encoded = base64.b64encode(raw).decode("utf-8")
            return {"Authorization": f"Basic {encoded}"}
        if mode == "header":
            if not config.header_value:
                return {}
            return {config.auth_header_name or "Authorization": config.header_value}
        return {}

    def _resolve_local(self, config: ModelRouterConfig, task: dict | None, stage_name: str | None, role: str | None, fallback_model: str | None) -> dict[str, Any]:
        task_type = (task or {}).get("type")
        resolved = None
        source = "default"
        if role and role in config.role_models:
            resolved = config.role_models[role]
            source = "role"
        elif stage_name and stage_name in config.stage_models:
            resolved = config.stage_models[stage_name]
            source = "stage"
        elif task_type and task_type in config.task_type_models:
            resolved = config.task_type_models[task_type]
            source = "taskType"
        else:
            resolved = fallback_model or config.default_model
        return {
            "model": resolved,
            "source": source,
            "authMode": config.auth_mode,
            "routerUrl": config.url,
            "provider": "local",
        }

    def _normalize_remote_response(self, payload: Any) -> dict[str, Any]:
        if isinstance(payload, str):
            return {"model": payload}
        if isinstance(payload, dict):
            if isinstance(payload.get("route"), dict):
                payload = {**payload, **payload["route"]}
            model = payload.get("model") or payload.get("selectedModel") or payload.get("name")
            if model:
                return {**payload, "model": str(model)}
        raise ValueError("model router response did not include a model")

    def _resolve_remote(self, config: ModelRouterConfig, task: dict | None, stage_name: str | None, role: str | None, fallback_model: str | None) -> dict[str, Any]:
        payload = {
            "taskId": (task or {}).get("taskId"),
            "runId": (task or {}).get("runId"),
            "taskType": (task or {}).get("type"),
            "topic": (task or {}).get("topic"),
            "stage": stage_name,
            "role": role,
            "defaultModel": config.default_model,
            "fallbackModel": fallback_model or config.default_model,
            "routeHints": {
                "roleModels": config.role_models,
                "stageModels": config.stage_models,
                "taskTypeModels": config.task_type_models,
            },
        }
        request = urllib.request.Request(
            config.url or "",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", **self._auth_headers(config)},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            body = json.loads(response.read().decode("utf-8"))
        resolved = self._normalize_remote_response(body)
        resolved.setdefault("provider", "remote")
        resolved.setdefault("source", "remote")
        resolved.setdefault("routerUrl", config.url)
        resolved.setdefault("authMode", config.auth_mode)
        return resolved

    def resolve(
        self,
        *,
        task: dict | None = None,
        stage_name: str | None = None,
        role: str | None = None,
        fallback_model: str | None = None,
    ) -> dict[str, Any]:
        with self.lock:
            config = self.config.copy()
        local = self._resolve_local(config, task, stage_name, role, fallback_model)
        if not config.url:
            return local
        try:
            remote = self._resolve_remote(config, task, stage_name, role, fallback_model or local["model"])
            remote.setdefault("source", "remote")
            remote.setdefault("provider", "remote")
            return remote
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            return {**local, "source": "remote-fallback"}
