package com.idea.workshop.agents

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AgentControllerTest {
    private val controller = AgentController()

    @Test
    fun `normalize_dedupe removes duplicate urls`() {
        val request = AgentRequest(
            sources = listOf(
                SourceArticle(id = "a", title = "One", url = "https://example.com/a"),
                SourceArticle(id = "b", title = "Duplicate", url = "https://example.com/a"),
                SourceArticle(id = "c", title = "Two", url = "https://example.com/c")
            )
        )

        @Suppress("UNCHECKED_CAST")
        val response = controller.execute("normalize_dedupe", request)["sources"] as List<SourceArticle>
        assertEquals(2, response.size)
        assertEquals(listOf("a", "c"), response.map { it.id })
    }

    @Test
    fun `draft_script returns sourced sections`() {
        val ranked = listOf(
            SourceArticle(id = "a", title = "Agent platforms rise", snippet = "Durability is becoming standard.", url = "https://example.com/a", source = "A"),
            SourceArticle(id = "b", title = "Voice interfaces return", snippet = "Speech control is back.", url = "https://example.com/b", source = "B")
        )
        val structure = mapOf(
            "titleOptions" to listOf("Agent podcast title"),
            "sections" to listOf(
                mapOf("slug" to "intro", "heading" to "Why it matters"),
                mapOf("slug" to "signals", "heading" to "Signals")
            )
        )
        val request = AgentRequest(topic = "agent podcast", ranked = ranked, structure = structure)

        @Suppress("UNCHECKED_CAST")
        val response = controller.execute("draft_script", request)
        val sections = response["scriptSections"] as List<ScriptSection>
        assertEquals("Agent podcast title", response["episodeTitle"])
        assertEquals(2, sections.size)
        assertTrue(sections.first().lines.first().citations.isNotEmpty())
    }

    @Test
    fun `citation_validator drops unsupported lines`() {
        val script = ScriptPackage(
            episodeTitle = "Monitoring",
            scriptSections = listOf(
                ScriptSection(
                    heading = "Intro",
                    lines = listOf(
                        ScriptLine(text = "keep", citations = listOf("src1")),
                        ScriptLine(text = "drop", citations = listOf("missing"))
                    )
                )
            ),
            summary = "summary"
        )
        val request = AgentRequest(
            sources = listOf(SourceArticle(id = "src1", title = "Source 1")),
            script = script
        )

        @Suppress("UNCHECKED_CAST")
        val response = controller.execute("citation_validator", request)
        val sections = response["scriptSections"] as List<ScriptSection>
        val validation = response["validation"] as Map<String, Any>
        assertEquals(1, sections.first().lines.size)
        assertEquals(1, validation["droppedLines"])
    }
}
