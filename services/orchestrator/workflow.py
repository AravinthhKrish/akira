from __future__ import annotations

from dataclasses import dataclass

try:
    from langgraph.graph import END, START, StateGraph
except ModuleNotFoundError:  # pragma: no cover
    END = "__end__"
    START = "__start__"
    StateGraph = None


@dataclass(frozen=True)
class Stage:
    name: str
    progress: int
    role: str | None = None


STAGES = [
    Stage("accept_request", 5),
    Stage("retrieve_sources", 15, "source_discovery"),
    Stage("normalize_dedupe", 30, "normalize_dedupe"),
    Stage("rank_cluster", 45, "rank_cluster"),
    Stage("draft_structure", 60, "draft_structure"),
    Stage("generate_script", 75, "draft_script"),
    Stage("validate_citations", 88, "citation_validator"),
    Stage("publish_artifact_package", 100, "show_notes"),
]


def build_news_graph():
    if StateGraph is None:
        return STAGES
    graph = StateGraph(dict)
    for stage in STAGES:
        graph.add_node(stage.name, lambda state, stage_name=stage.name: {**state, "stage": stage_name})
    graph.add_edge(START, STAGES[0].name)
    for current, nxt in zip(STAGES, STAGES[1:]):
        graph.add_edge(current.name, nxt.name)
    graph.add_edge(STAGES[-1].name, END)
    return graph.compile()

