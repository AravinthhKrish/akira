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


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen = set()
    cleaned = []
    for item in value:
        model = str(item).strip()
        if model and model not in seen:
            seen.add(model)
            cleaned.append(model)
    return cleaned


@dataclass
class LlmProviderConfig:
    provider_id: str
    label: str = ""
    url: str | None = None
    auth_mode: str = "none"
    auth_header_name: str = "Authorization"
    bearer_token: str | None = None
    basic_username: str | None = None
    basic_password: str | None = None
    header_value: str | None = None
    models: list[str] = field(default_factory=list)
    default_model: str | None = None
    enabled: bool = True

    @classmethod
    def from_payload(cls, provider_id: str, payload: dict[str, Any]) -> "LlmProviderConfig":
        credentials = payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {}
        models = _clean_list(payload.get("models"))
        default_model = str(payload.get("defaultModel") or payload.get("default_model") or (models[0] if models else "")).strip() or None
        if default_model and default_model not in models:
            models.insert(0, default_model)
        return cls(
            provider_id=provider_id,
            label=str(payload.get("label") or payload.get("name") or provider_id),
            url=ModelRouter._normalize_url(None, payload.get("url") or payload.get("baseUrl") or payload.get("apiUrl")),
            auth_mode=str(payload.get("authMode") or payload.get("auth_mode") or "none").strip().lower(),
            auth_header_name=str(payload.get("authHeaderName") or payload.get("auth_header_name") or "Authorization"),
            bearer_token=credentials.get("bearerToken") or payload.get("bearerToken"),
            basic_username=credentials.get("basicUsername") or payload.get("basicUsername"),
            basic_password=credentials.get("basicPassword") or payload.get("basicPassword"),
            header_value=credentials.get("headerValue") or payload.get("headerValue"),
            models=models,
            default_model=default_model,
            enabled=bool(payload.get("enabled", True)),
        )

    def copy(self) -> "LlmProviderConfig":
        return LlmProviderConfig(
            provider_id=self.provider_id,
            label=self.label,
            url=self.url,
            auth_mode=self.auth_mode,
            auth_header_name=self.auth_header_name,
            bearer_token=self.bearer_token,
            basic_username=self.basic_username,
            basic_password=self.basic_password,
            header_value=self.header_value,
            models=list(self.models),
            default_model=self.default_model,
            enabled=self.enabled,
        )

    def public_dict(self) -> dict[str, Any]:
        return {
            "id": self.provider_id,
            "label": self.label or self.provider_id,
            "url": self.url,
            "authMode": self.auth_mode,
            "authHeaderName": self.auth_header_name,
            "models": list(self.models),
            "defaultModel": self.default_model,
            "enabled": self.enabled,
            "credentials": {
                "hasBearerToken": bool(self.bearer_token),
                "hasBasicCredentials": bool(self.basic_username and self.basic_password),
                "hasHeaderValue": bool(self.header_value),
            },
        }


def _load_provider_configs(value: str | None, default_model: str, extra_models: list[str] | None = None) -> dict[str, LlmProviderConfig]:
    parsed = None
    if value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = None
    providers: dict[str, LlmProviderConfig] = {}
    if isinstance(parsed, list):
        for item in parsed:
            if not isinstance(item, dict):
                continue
            provider_id = str(item.get("id") or item.get("provider") or item.get("name") or "").strip()
            if provider_id:
                providers[provider_id] = LlmProviderConfig.from_payload(provider_id, item)
    elif isinstance(parsed, dict):
        for provider_id, item in parsed.items():
            if isinstance(item, dict) and str(provider_id).strip():
                providers[str(provider_id).strip()] = LlmProviderConfig.from_payload(str(provider_id).strip(), item)
    if not providers:
        models = _clean_list([default_model, *(extra_models or [])])
        providers["local"] = LlmProviderConfig(
            provider_id="local",
            label="Local fallback",
            models=models,
            default_model=default_model,
            enabled=True,
        )
    return providers


def _provider_from_update(provider_id: str, payload: dict[str, Any], previous: LlmProviderConfig | None) -> LlmProviderConfig:
    provider = LlmProviderConfig.from_payload(provider_id, payload)
    credentials = payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {}
    has_secret_update = any(
        key in payload or key in credentials
        for key in ("bearerToken", "basicUsername", "basicPassword", "headerValue")
    )
    if previous and not has_secret_update:
        provider.bearer_token = previous.bearer_token
        provider.basic_username = previous.basic_username
        provider.basic_password = previous.basic_password
        provider.header_value = previous.header_value
    return provider


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
    providers: dict[str, LlmProviderConfig] = field(default_factory=dict)
    default_provider: str = "local"
    catalog_enforced: bool = False
    timeout_seconds: int = 15
    source: str = "env"

    @classmethod
    def from_env(cls) -> "ModelRouterConfig":
        default_model = os.environ.get("MODEL_ROUTER_DEFAULT_MODEL", "gpt-4.1-mini")
        role_models = _clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_ROLE_MODELS_JSON")))
        stage_models = _clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_STAGE_MODELS_JSON")))
        task_type_models = _clean_map(_load_json_object(os.environ.get("MODEL_ROUTER_TASK_TYPE_MODELS_JSON")))
        providers = _load_provider_configs(
            os.environ.get("MODEL_ROUTER_PROVIDERS_JSON"),
            default_model,
            [*role_models.values(), *stage_models.values(), *task_type_models.values()],
        )
        default_provider = os.environ.get("MODEL_ROUTER_DEFAULT_PROVIDER", next(iter(providers.keys()), "local"))
        return cls(
            url=ModelRouter._normalize_url(None, os.environ.get("MODEL_ROUTER_URL")),
            auth_mode=os.environ.get("MODEL_ROUTER_AUTH_MODE", "none").strip().lower(),
            auth_header_name=os.environ.get("MODEL_ROUTER_AUTH_HEADER_NAME", "Authorization"),
            bearer_token=os.environ.get("MODEL_ROUTER_BEARER_TOKEN"),
            basic_username=os.environ.get("MODEL_ROUTER_BASIC_USERNAME"),
            basic_password=os.environ.get("MODEL_ROUTER_BASIC_PASSWORD"),
            header_value=os.environ.get("MODEL_ROUTER_HEADER_VALUE"),
            default_model=default_model,
            role_models=role_models,
            stage_models=stage_models,
            task_type_models=task_type_models,
            providers=providers,
            default_provider=default_provider if default_provider in providers else next(iter(providers.keys()), "local"),
            catalog_enforced=bool(os.environ.get("MODEL_ROUTER_PROVIDERS_JSON")),
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
            providers={key: provider.copy() for key, provider in self.providers.items()},
            default_provider=self.default_provider,
            catalog_enforced=self.catalog_enforced,
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
        if "providers" in payload:
            next_config.catalog_enforced = True
            previous_providers = {key: provider.copy() for key, provider in next_config.providers.items()}
            next_config.providers = {}
            providers = payload.get("providers")
            if isinstance(providers, list):
                for item in providers:
                    if not isinstance(item, dict):
                        continue
                    provider_id = str(item.get("id") or item.get("provider") or item.get("name") or "").strip()
                    if provider_id:
                        next_config.providers[provider_id] = _provider_from_update(provider_id, item, previous_providers.get(provider_id))
            elif isinstance(providers, dict):
                for provider_id, item in providers.items():
                    if isinstance(item, dict) and str(provider_id).strip():
                        provider_key = str(provider_id).strip()
                        next_config.providers[provider_key] = _provider_from_update(provider_key, item, previous_providers.get(provider_key))
            if not next_config.providers:
                next_config.providers = _load_provider_configs(None, next_config.default_model)
        if "defaultProvider" in payload:
            next_config.default_provider = str(payload.get("defaultProvider") or next_config.default_provider)
        if next_config.default_provider not in next_config.providers:
            next_config.default_provider = next(iter(next_config.providers.keys()), "local")
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
            "providers": [provider.public_dict() for provider in self.providers.values()],
            "defaultProvider": self.default_provider,
            "catalogEnforced": self.catalog_enforced,
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
        self._ensure_provider_catalog(self.config)

    @staticmethod
    def _normalize_url(previous: str | None, value: Any) -> str | None:
        if value is None:
            return previous
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _ensure_provider_catalog(config: ModelRouterConfig) -> None:
        if config.providers:
            return
        models = _clean_list(
            [
                config.default_model,
                *config.role_models.values(),
                *config.stage_models.values(),
                *config.task_type_models.values(),
            ]
        )
        config.providers = {
            "local": LlmProviderConfig(
                provider_id="local",
                label="Local fallback",
                models=models,
                default_model=config.default_model,
                enabled=True,
            )
        }
        config.default_provider = "local"

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

    def _split_model_reference(self, value: str | None) -> tuple[str | None, str | None]:
        text = str(value or "").strip()
        if not text:
            return None, None
        for separator in ("::", ":"):
            if separator in text:
                provider_id, model = text.split(separator, 1)
                provider_id = provider_id.strip()
                model = model.strip()
                if provider_id and model:
                    return provider_id, model
        return None, text

    def _enabled_provider(self, config: ModelRouterConfig, provider_id: str | None) -> LlmProviderConfig | None:
        if provider_id and provider_id in config.providers and config.providers[provider_id].enabled:
            return config.providers[provider_id]
        provider = config.providers.get(config.default_provider)
        if provider and provider.enabled:
            return provider
        return next((candidate for candidate in config.providers.values() if candidate.enabled), None)

    def _route_from_selection(
        self,
        config: ModelRouterConfig,
        selection: str | None,
        source: str,
        fallback_model: str | None,
    ) -> dict[str, Any]:
        requested_provider_id, requested_model = self._split_model_reference(selection or fallback_model or config.default_model)
        provider = self._enabled_provider(config, requested_provider_id)
        warning = None
        catalog_matched = False
        if not provider:
            provider = LlmProviderConfig(provider_id="local", label="Local fallback", models=[config.default_model], default_model=config.default_model)
            warning = "No enabled LLM provider is configured; using local fallback."
        model = requested_model or provider.default_model or config.default_model
        if requested_provider_id and requested_provider_id != provider.provider_id:
            warning = f"Provider {requested_provider_id} is not enabled or configured; using {provider.provider_id}."
        if model in provider.models:
            catalog_matched = True
        else:
            matching_provider = next((candidate for candidate in config.providers.values() if candidate.enabled and model in candidate.models), None)
            if matching_provider and not requested_provider_id:
                provider = matching_provider
                catalog_matched = True
            elif not config.catalog_enforced:
                warning = f"Model {model} is not in provider {provider.provider_id}; allowing legacy uncataloged routing."
            elif provider.models:
                replacement = provider.default_model if provider.default_model in provider.models else provider.models[0]
                warning = f"Model {model} is not in provider {provider.provider_id}; using configured model {replacement}."
                model = replacement
                catalog_matched = True
            else:
                warning = f"Provider {provider.provider_id} has no configured models; using {model} as fallback."
        return {
            "model": model,
            "provider": provider.provider_id,
            "providerLabel": provider.label or provider.provider_id,
            "providerUrl": provider.url,
            "source": source,
            "authMode": provider.auth_mode,
            "routerUrl": config.url,
            "catalogMatched": catalog_matched,
            "configuredModels": list(provider.models),
            **({"warning": warning} if warning else {}),
        }

    def _resolve_local(self, config: ModelRouterConfig, task: dict | None, stage_name: str | None, role: str | None, fallback_model: str | None) -> dict[str, Any]:
        task_type = (task or {}).get("type")
        task_model_preference = (task or {}).get("modelPreference")
        selection = None
        source = "default"
        if task_model_preference:
            selection = task_model_preference
            source = "taskPreference"
        elif role and role in config.role_models:
            selection = config.role_models[role]
            source = "role"
        elif stage_name and stage_name in config.stage_models:
            selection = config.stage_models[stage_name]
            source = "stage"
        elif task_type and task_type in config.task_type_models:
            selection = config.task_type_models[task_type]
            source = "taskType"
        else:
            selection = fallback_model or config.default_model
        return self._route_from_selection(config, selection, source, fallback_model)

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
            "modelPreference": (task or {}).get("modelPreference"),
            "stage": stage_name,
            "role": role,
            "defaultModel": config.default_model,
            "fallbackModel": fallback_model or config.default_model,
            "routeHints": {
                "roleModels": config.role_models,
                "stageModels": config.stage_models,
                "taskTypeModels": config.task_type_models,
                "providers": [provider.public_dict() for provider in config.providers.values()],
                "defaultProvider": config.default_provider,
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
        catalog_route = self._route_from_selection(config, resolved.get("model"), str(resolved.get("source") or "remote"), fallback_model)
        resolved = {**resolved, **catalog_route}
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
