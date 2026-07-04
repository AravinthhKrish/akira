package com.idea.workshop.agents

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.lang.management.ManagementFactory
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

@SpringBootApplication
class AgentRuntimeApplication

fun main(args: Array<String>) {
    runApplication<AgentRuntimeApplication>(*args)
}

data class SourceArticle(
    val id: String = "",
    val title: String = "",
    val snippet: String = "",
    val url: String = "",
    val source: String = "",
    val publishedAt: String = Instant.now().toString()
)

data class StructureSection(
    val slug: String = "",
    val heading: String = ""
)

data class ScriptLine(
    val text: String = "",
    val citations: List<String> = emptyList()
)

data class ScriptSection(
    val heading: String = "",
    val lines: List<ScriptLine> = emptyList()
)

data class ScriptPackage(
    val episodeTitle: String = "",
    val showNotes: List<String> = emptyList(),
    val scriptSections: List<ScriptSection> = emptyList(),
    val summary: String = "",
    val validation: Map<String, Any?> = emptyMap()
)

data class AgentRequest(
    val topic: String? = null,
    val sources: List<SourceArticle> = emptyList(),
    val ranked: List<SourceArticle> = emptyList(),
    val structure: Map<String, Any?> = emptyMap(),
    val script: ScriptPackage? = null
)

object AgentRuntimeMetrics {
    val requestCount = AtomicLong(0)
    val errorCount = AtomicLong(0)
}

@RestController
class InfrastructureController {
    @GetMapping("/health", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun health(): Map<String, Any> = mapOf(
        "ok" to true,
        "service" to "agent-runtime"
    )

    @GetMapping("/metrics", produces = ["text/plain; version=0.0.4; charset=utf-8"])
    fun metrics(): ResponseEntity<String> {
        val runtime = Runtime.getRuntime()
        val heapUsed = runtime.totalMemory() - runtime.freeMemory()
        val lines = listOf(
            "process_resident_memory_kilobytes ${runtime.totalMemory() / 1024}",
            "process_heap_used_bytes $heapUsed",
            "akira_http_requests_total{service=\"agent-runtime\"} ${AgentRuntimeMetrics.requestCount.get()}",
            "akira_http_errors_total{service=\"agent-runtime\"} ${AgentRuntimeMetrics.errorCount.get()}",
            "jvm_thread_count ${ManagementFactory.getThreadMXBean().threadCount}"
        )
        return ResponseEntity.ok(lines.joinToString("\n", postfix = "\n"))
    }
}

@RestController
@RequestMapping("/v1/agents")
class AgentController {
    @PostMapping("/{role}", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun execute(
        @PathVariable role: String,
        @RequestBody request: AgentRequest
    ): Map<String, Any?> {
        AgentRuntimeMetrics.requestCount.incrementAndGet()
        return try {
            when (role) {
                "source_discovery" -> mapOf("sources" to request.sources)
                "normalize_dedupe" -> mapOf("sources" to dedupeSources(request.sources))
                "rank_cluster" -> rankAndCluster(request.sources)
                "draft_structure" -> draftStructure(request.topic.orEmpty(), request.ranked)
                "draft_script" -> draftScript(request.topic.orEmpty(), request.structure, request.ranked)
                "citation_validator" -> validateScript(request.script, request.sources)
                "show_notes" -> mapOf(
                    "showNotes" to request.sources.take(4).map { "${it.title} - ${it.url}" }
                )
                else -> {
                    AgentRuntimeMetrics.errorCount.incrementAndGet()
                    mapOf(
                        "role" to role,
                        "simulated" to false,
                        "error" to "Unknown role"
                    )
                }
            }
        } catch (error: Exception) {
            AgentRuntimeMetrics.errorCount.incrementAndGet()
            mapOf(
                "role" to role,
                "simulated" to false,
                "error" to (error.message ?: "unknown error")
            )
        }
    }

    private fun dedupeSources(sources: List<SourceArticle>): List<SourceArticle> {
        val seen = mutableSetOf<String>()
        return sources.filter { source ->
            val key = source.url.ifBlank { source.title }
            if (seen.contains(key)) {
                false
            } else {
                seen.add(key)
                true
            }
        }
    }

    private fun rankAndCluster(sources: List<SourceArticle>): Map<String, Any> {
        val ranked = sources.sortedWith(
            compareByDescending<SourceArticle> { it.publishedAt }.thenByDescending { it.source }
        )
        val clusters = listOf(
            mapOf("theme" to "platform", "storyIds" to ranked.take(2).map { it.id }),
            mapOf("theme" to "experience", "storyIds" to ranked.drop(2).take(2).map { it.id })
        )
        return mapOf(
            "ranked" to ranked,
            "clusters" to clusters
        )
    }

    private fun draftStructure(topic: String, ranked: List<SourceArticle>): Map<String, Any> {
        return mapOf(
            "titleOptions" to listOf(
                "${topic.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }}: the agent platform shift",
                "${topic.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }}: from demos to durable systems"
            ),
            "sections" to listOf(
                StructureSection("intro", "Why $topic matters right now"),
                StructureSection("signals", "What the sources are converging on"),
                StructureSection("implications", "What this means for builders"),
                StructureSection("close", "The next question to watch")
            ),
            "leadSources" to ranked.take(3)
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun draftScript(topic: String, structure: Map<String, Any?>, ranked: List<SourceArticle>): Map<String, Any> {
        val sections = structure["sections"] as? List<Map<String, Any?>> ?: emptyList()
        val scriptSections = sections.mapIndexed { index, section ->
            val source = ranked.getOrElse(index) { ranked.lastOrNull() ?: SourceArticle() }
            ScriptSection(
                heading = section["heading"]?.toString().orEmpty(),
                lines = listOf(
                    ScriptLine(
                        text = "${section["heading"]}: ${source.title}. ${source.snippet}",
                        citations = listOf(source.id)
                    )
                )
            )
        }
        return mapOf(
            "episodeTitle" to ((structure["titleOptions"] as? List<*>)?.firstOrNull()?.toString()
                ?: "$topic: sourced monitoring update"),
            "showNotes" to ranked.take(4).map { "${it.title} (${it.source}) - ${it.url}" },
            "scriptSections" to scriptSections,
            "summary" to "A sourced digest on $topic built from ${ranked.size} retrieved articles."
        )
    }

    private fun validateScript(script: ScriptPackage?, sources: List<SourceArticle>): Map<String, Any> {
        val allowed = sources.map { it.id }.toSet()
        val cleanedSections = script?.scriptSections.orEmpty().map { section ->
            val cleanedLines = section.lines.filter { line ->
                line.citations.any { it in allowed }
            }.map { line ->
                line.copy(citations = line.citations.filter { it in allowed })
            }
            ScriptSection(section.heading, cleanedLines)
        }
        val droppedLines = script?.scriptSections.orEmpty().sumOf { section ->
            section.lines.count { line -> line.citations.none { it in allowed } }
        }
        return mapOf(
            "episodeTitle" to (script?.episodeTitle ?: ""),
            "showNotes" to (script?.showNotes ?: emptyList<String>()),
            "scriptSections" to cleanedSections,
            "summary" to (script?.summary ?: ""),
            "validation" to mapOf(
                "droppedLines" to droppedLines,
                "citationCoverage" to "strict"
            )
        )
    }
}
