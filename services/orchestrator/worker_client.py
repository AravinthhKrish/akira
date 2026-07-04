import json
import urllib.request


def _dedupe_sources(sources: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for source in sources:
        key = source.get("url") or source.get("title")
        if key in seen:
            continue
        seen.add(key)
        unique.append(source)
    return unique


def _rank_and_cluster(sources: list[dict]) -> dict:
    ranked = sorted(
        sources,
        key=lambda source: (source.get("source", ""), source.get("publishedAt", "")),
        reverse=True,
    )
    clusters = [
        {
            "theme": "platform",
            "storyIds": [source["id"] for source in ranked[:2]],
        },
        {
            "theme": "experience",
            "storyIds": [source["id"] for source in ranked[2:4]],
        },
    ]
    return {"ranked": ranked, "clusters": clusters}


def _draft_structure(topic: str, ranked: list[dict]) -> dict:
    return {
        "titleOptions": [
            f"{topic.title()}: the agent platform shift",
            f"{topic.title()}: from demos to durable systems",
        ],
        "sections": [
            {"slug": "intro", "heading": f"Why {topic} matters right now"},
            {"slug": "signals", "heading": "What the sources are converging on"},
            {"slug": "implications", "heading": "What this means for builders"},
            {"slug": "close", "heading": "The next question to watch"},
        ],
        "leadSources": ranked[:3],
    }


def _draft_script(topic: str, structure: dict, ranked: list[dict]) -> dict:
    script_sections = []
    for index, section in enumerate(structure["sections"]):
        source = ranked[min(index, len(ranked) - 1)]
        script_sections.append(
            {
                "heading": section["heading"],
                "lines": [
                    {
                        "text": f"{section['heading']}: {source['title']}. {source['snippet']}",
                        "citations": [source["id"]],
                    }
                ],
            }
        )
    return {
        "episodeTitle": structure["titleOptions"][0],
        "showNotes": [
            f"{source['title']} ({source['source']}) - {source['url']}"
            for source in ranked[:4]
        ],
        "scriptSections": script_sections,
        "summary": f"A sourced digest on {topic} built from {len(ranked)} retrieved articles.",
    }


def _validate_script(script: dict, sources: list[dict]) -> dict:
    allowed = {source["id"] for source in sources}
    cleaned_sections = []
    dropped_lines = 0
    for section in script["scriptSections"]:
        cleaned_lines = []
        for line in section["lines"]:
            citations = [citation for citation in line["citations"] if citation in allowed]
            if not citations:
                dropped_lines += 1
                continue
            cleaned_lines.append({**line, "citations": citations})
        cleaned_sections.append({**section, "lines": cleaned_lines})
    return {
        **script,
        "scriptSections": cleaned_sections,
        "validation": {
            "droppedLines": dropped_lines,
            "citationCoverage": "strict",
        },
    }


class WorkerClient:
    def __init__(self, base_url: str | None):
        self.base_url = base_url.rstrip("/") if base_url else None

    def _call_remote(self, role: str, payload: dict):
        request = urllib.request.Request(
            f"{self.base_url}/v1/agents/{role}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    def execute(self, role: str, payload: dict) -> dict:
        if self.base_url:
            try:
                return self._call_remote(role, payload)
            except Exception:
                pass

        if role == "source_discovery":
            return {"sources": payload["sources"]}
        if role == "normalize_dedupe":
            return {"sources": _dedupe_sources(payload["sources"])}
        if role == "rank_cluster":
            return _rank_and_cluster(payload["sources"])
        if role == "draft_structure":
            return _draft_structure(payload["topic"], payload["ranked"])
        if role == "draft_script":
            return _draft_script(payload["topic"], payload["structure"], payload["ranked"])
        if role == "citation_validator":
            return _validate_script(payload["script"], payload["sources"])
        if role == "show_notes":
            return {
                "showNotes": [
                    f"{source['title']} - {source['url']}"
                    for source in payload["sources"][:4]
                ]
            }
        raise ValueError(f"unknown role: {role}")
