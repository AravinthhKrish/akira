import json
import urllib.request


def fallback_articles(topic: str) -> list[dict]:
    base = [
        {
            "id": "src_ai_launch",
            "title": "Open agent platforms keep moving toward durable orchestration",
            "snippet": "Teams are shifting from prompt chains to replayable, observable agent runtimes.",
            "url": "https://example.local/agents/durable-orchestration",
            "source": "Simulated Wire",
            "publishedAt": "2026-07-04T08:00:00Z",
        },
        {
            "id": "src_voice_control",
            "title": "Voice interfaces return as control layers for personal automation",
            "snippet": "Wake-word flows and speech-to-text are being paired with explicit approval controls.",
            "url": "https://example.local/voice/control-layer",
            "source": "Simulated Journal",
            "publishedAt": "2026-07-04T08:10:00Z",
        },
        {
            "id": "src_event_logs",
            "title": "Event logs and checkpointing define the new agent reliability stack",
            "snippet": "Replayable execution history is becoming table stakes for serious multi-agent systems.",
            "url": "https://example.local/events/replayability",
            "source": "Simulated Ledger",
            "publishedAt": "2026-07-04T08:20:00Z",
        },
        {
            "id": "src_topic_specific",
            "title": f"{topic.title()} stays central to the current agent tooling wave",
            "snippet": f"Developers keep asking how {topic} can plug into orchestration, storage, and voice surfaces.",
            "url": "https://example.local/topic/current-wave",
            "source": "Simulated Briefing",
            "publishedAt": "2026-07-04T08:30:00Z",
        },
    ]
    return base


class MCPClient:
    def __init__(self, base_url: str | None):
        self.base_url = base_url.rstrip("/") if base_url else None

    def search_news(self, topic: str, limit: int = 6) -> dict:
        if not self.base_url:
            return {
                "articles": fallback_articles(topic)[:limit],
                "freshness": "simulated-local",
            }

        payload = {
            "toolId": "news.search_articles",
            "params": {"query": topic, "limit": limit},
        }
        request = urllib.request.Request(
            f"{self.base_url}/api/mcp/execute",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
        result = body.get("result", {})
        return {
            "articles": result.get("articles", [])[:limit],
            "freshness": result.get("freshness", "live"),
        }

