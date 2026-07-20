const profileName = "Aravind";

const state = {
  activeView: "home",
  dashboard: null,
  selectedTaskId: null,
  selectedTaskReplayTaskId: null,
  selectedTaskReplay: [],
  liveTaskId: null,
  connectedTaskId: null,
  liveEvents: [],
  voiceSocket: null,
  recognition: null,
  voiceEnabled: false,
  audioEnabled: true,
  eventSource: null,
  newsComposerOpen: false,
};

const els = {
  greetingLabel: document.querySelector("#greeting-label"),
  headline: document.querySelector("#headline"),
  subheadline: document.querySelector("#subheadline"),
  summaryCards: document.querySelector("#summary-cards"),
  heroPanel: document.querySelector("#hero-panel"),
  homeUpdates: document.querySelector("#home-updates"),
  homeHighlights: document.querySelector("#home-highlights"),
  homeAgents: document.querySelector("#home-agents"),
  homeAlerts: document.querySelector("#home-alerts"),
  podcastTranscript: document.querySelector("#podcast-transcript"),
  podcastArtifact: document.querySelector("#podcast-artifact"),
  podcastAudio: document.querySelector("#podcast-audio"),
  tasksList: document.querySelector("#tasks-list"),
  taskDetail: document.querySelector("#task-detail"),
  agentsRoster: document.querySelector("#agents-roster"),
  agentsMap: document.querySelector("#agents-map"),
  alertsList: document.querySelector("#alerts-list"),
  alertsMonitoring: document.querySelector("#alerts-monitoring"),
  createTask: document.querySelector("#create-task"),
  runMonitoringDigest: document.querySelector("#run-monitoring-digest"),
  voiceToggle: document.querySelector("#voice-toggle"),
  audioToggle: document.querySelector("#audio-toggle"),
  connectionBadge: document.querySelector("#connection-badge"),
  voiceBadge: document.querySelector("#voice-badge"),
  newsTaskModal: document.querySelector("#news-task-modal"),
  newsTaskForm: document.querySelector("#news-task-form"),
  newsTaskCloseButtons: Array.from(document.querySelectorAll("[data-close-task-modal]")),
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  views: Array.from(document.querySelectorAll(".view")),
};

const toneClasses = {
  violet: "tone-violet",
  blue: "tone-blue",
  green: "tone-green",
  amber: "tone-amber",
  pink: "tone-violet",
  indigo: "tone-violet",
  teal: "tone-blue",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTimeOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function api(path, options = {}) {
  return fetch(`/api${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  });
}

function readSourceValue(source, name) {
  if (!source) return "";
  if (typeof source.get === "function") {
    const value = source.get(name);
    return value == null ? "" : String(value);
  }
  if (Object.prototype.hasOwnProperty.call(source, name)) {
    const value = source[name];
    return value == null ? "" : String(value);
  }
  return "";
}

function splitProfileList(value) {
  return String(value || "")
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveMinutes(value, fallback = 0) {
  const normalized = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isNaN(normalized) || normalized < 0) {
    return fallback;
  }
  return normalized;
}

export function buildNewsTaskPayload(source) {
  const topic = readSourceValue(source, "topic").trim();
  const freshnessWindowMinutes = parsePositiveMinutes(readSourceValue(source, "freshnessWindowMinutes"), 240) || 240;
  const refreshEveryMinutes = parsePositiveMinutes(readSourceValue(source, "refreshEveryMinutes"), 0);
  const scheduleEnabled = readSourceValue(source, "scheduleEnabled") === "on" || readSourceValue(source, "scheduleEnabled") === "true" || refreshEveryMinutes > 0;
  return {
    type: "news-podcast",
    topic,
    newsContext: {
      topic,
      focusKeywords: splitProfileList(readSourceValue(source, "focusKeywords")),
      exclusions: splitProfileList(readSourceValue(source, "exclusions")),
      entities: splitProfileList(readSourceValue(source, "entities")),
      sourcePreferences: splitProfileList(readSourceValue(source, "sourcePreferences")),
      freshnessWindowMinutes,
    },
    newsSchedule: {
      enabled: scheduleEnabled,
      refreshEveryMinutes: scheduleEnabled ? (refreshEveryMinutes || 60) : 0,
    },
  };
}

function progressClass(value) {
  if (value >= 90) return "green";
  if (value >= 70) return "blue";
  if (value >= 40) return "amber";
  return "pink";
}

function summaryIcon(key) {
  const icons = {
    activeAgents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M4 12h4M16 12h4M12 4v4M12 16v4"></path></svg>`,
    tasksInProgress: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="3"></rect><path d="M8 9h8M8 13h8"></path></svg>`,
    tasksCompleted: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`,
    alerts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 19h16L12 3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`,
  };
  return icons[key] || icons.activeAgents;
}

function setView(view) {
  state.activeView = view;
  for (const item of els.navItems) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  for (const pane of els.views) {
    pane.classList.toggle("active", pane.id === `view-${view}`);
  }
}

function taskLookup(taskId) {
  return state.dashboard?.tasks?.find((task) => task.taskId === taskId) || null;
}

function selectedTask() {
  return taskLookup(state.selectedTaskId) || state.dashboard?.hero?.task || state.dashboard?.tasks?.[0] || null;
}

function selectedTaskEvents() {
  if (state.selectedTaskId && state.selectedTaskId === state.liveTaskId) {
    return state.liveEvents;
  }
  return state.selectedTaskReplay;
}

function selectedTaskArtifact(task) {
  const artifacts = task?.artifacts || [];
  const item = artifacts[artifacts.length - 1];
  return item || null;
}

function selectedTaskSources(task) {
  const artifact = selectedTaskArtifact(task);
  return artifact?.sources || [];
}

function selectedTaskScript(task) {
  const artifact = selectedTaskArtifact(task);
  return artifact?.scriptSections || [];
}

function activeTranscriptLine() {
  const events = selectedTaskEvents();
  const narrative = [...events].reverse().find((event) => event?.data?.audience === "narrative");
  return narrative?.data?.message || state.dashboard?.hero?.speaker || "Narration standing by";
}

function renderTagList(items = []) {
  return items
    .map((item) => `<span class="tag-chip">${escapeHtml(item)}</span>`)
    .join("");
}

function renderNewsProfile(task) {
  const context = task?.newsContext || {};
  const schedule = task?.newsSchedule || {};
  const query = task?.newsQuery || "";
  const contextItems = [
    {
      label: "Topic",
      value: context.topic || task?.topic || "Unspecified",
    },
    {
      label: "Freshness",
      value: context.freshnessWindowMinutes ? `${context.freshnessWindowMinutes} minutes` : "Default",
    },
    {
      label: "Schedule",
      value: schedule.enabled ? `Every ${schedule.refreshEveryMinutes || 60} minutes` : "One-time",
    },
    {
      label: "Refreshes",
      value: schedule.refreshCount ? String(schedule.refreshCount) : "0",
    },
  ];
  return `
    <div class="news-profile">
      <div class="panel-subtitle">News profile</div>
      <div class="news-profile-grid">
        ${contextItems
          .map(
            (item) => `
              <div class="metric-box">
                <div class="metric-label">${escapeHtml(item.label)}</div>
                <div class="metric-value">${escapeHtml(item.value)}</div>
              </div>`
          )
          .join("")}
      </div>
      <div class="news-profile-tags">
        <div class="tag-group">
          <div class="tag-group-label">Keywords</div>
          <div class="tag-list">${renderTagList(context.focusKeywords || []) || `<span class="section-note">No focus keywords</span>`}</div>
        </div>
        <div class="tag-group">
          <div class="tag-group-label">Entities</div>
          <div class="tag-list">${renderTagList(context.entities || []) || `<span class="section-note">No entities</span>`}</div>
        </div>
        <div class="tag-group">
          <div class="tag-group-label">Exclusions</div>
          <div class="tag-list">${renderTagList(context.exclusions || []) || `<span class="section-note">None</span>`}</div>
        </div>
        <div class="tag-group">
          <div class="tag-group-label">Source preferences</div>
          <div class="tag-list">${renderTagList(context.sourcePreferences || []) || `<span class="section-note">No preferences</span>`}</div>
        </div>
      </div>
      <div class="news-query">
        <div class="tag-group-label">Expanded MCP query</div>
        <div class="query-copy">${escapeHtml(query || "Will be built from the task context at run time.")}</div>
      </div>
    </div>`;
}

function renderSummaryCards(cards = []) {
  els.summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card ${toneClasses[card.tone] || "tone-violet"}">
          <div class="summary-label">${escapeHtml(card.label)}</div>
          <div class="summary-value">${escapeHtml(card.value)}</div>
          <div class="summary-detail">${escapeHtml(card.detail)}</div>
          <div class="summary-badge" aria-hidden="true">${summaryIcon(card.key)}</div>
        </article>`
    )
    .join("");
}

function renderWaveform() {
  return `
    <div class="waveform" aria-hidden="true">
      ${Array.from({ length: 18 }, (_, index) => {
        const height = [28, 56, 44, 62, 34, 48, 68, 40, 54, 32, 62, 44, 58, 36, 48, 70, 42, 30][index];
        return `<span class="waveform-bar" style="height:${height}px; animation-delay:${(index % 6) * 0.12}s"></span>`;
      }).join("")}
    </div>`;
}

function renderHero() {
  const hero = state.dashboard?.hero || {};
  const task = hero.task || selectedTask();
  const audio = hero.audio;
  const status = hero.status || (task?.status === "working" ? "Live" : "Ready");
  const liveTaskLabel = task ? `${escapeHtml(task.topic || task.taskId)} • ${escapeHtml(task.stage || "Waiting")}` : "Nothing active";
  const transcript = activeTranscriptLine();
  const eventCount = selectedTaskEvents().length || 0;
  const body = `
    <div class="hero-shell">
      <div class="hero-radar">
        <div class="radar-ring">
          <div class="radar-mark">AK</div>
        </div>
      </div>
      <div class="hero-copy">
        <div class="hero-status">${escapeHtml(status)}</div>
        <h2 class="hero-headline">${escapeHtml(hero.title || "Agent Podcast (Live)")}</h2>
        <p class="hero-summary">${escapeHtml(hero.summary || "Listening to your agents. Humanized updates, just like AKIRA.")}</p>
        <div class="hero-speaker">${escapeHtml(transcript)}</div>
        <div class="hero-controls">
          <button class="hero-chip" id="hero-new-task">New task</button>
          <button class="hero-chip" id="hero-summary">Ask summary</button>
          <button class="hero-chip" id="hero-replay">Load replay</button>
          <button class="hero-chip" id="hero-voice-toggle">${state.voiceEnabled ? "Voice on" : "Voice off"}</button>
          <button class="hero-chip" id="hero-audio-toggle">${state.audioEnabled ? "Audio on" : "Audio off"}</button>
        </div>
        <div class="hero-mini-grid">
          <div class="hero-mini-card">
            <div class="hero-mini-label">Current Task</div>
            <div class="hero-mini-value">${escapeHtml(liveTaskLabel)}</div>
          </div>
          <div class="hero-mini-card">
            <div class="hero-mini-label">Live Events</div>
            <div class="hero-mini-value">${escapeHtml(eventCount)}</div>
          </div>
        </div>
        ${renderWaveform()}
        <div class="hero-audio">
          <div class="hero-mini-label">Playback</div>
          ${
            audio?.base64Data
              ? `<audio controls preload="none" src="data:${escapeHtml(audio.mimeType || "audio/wav")};base64,${audio.base64Data}"></audio>`
              : `<div class="footer-note">No audio artifact is attached to the current hero payload.</div>`
          }
        </div>
      </div>
    </div>`;
  els.heroPanel.innerHTML = body;
  bindHeroControls();
}

function renderHomeView() {
  const dashboard = state.dashboard || {};
  const monitoring = dashboard.monitoring || {};
  const updates = dashboard.updates || [];
  const highlights = dashboard.highlights || [];
  const agents = dashboard.agents || [];
  const alerts = dashboard.alerts || [];

  els.homeUpdates.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Recent Agent Updates</h3>
        <p class="panel-note">Activity flowing through the live control plane.</p>
      </div>
    </div>
    <div class="compact-list">
      ${updates
        .map(
          (item) => `
            <div class="compact-item">
              <div>
                <div class="name">${escapeHtml(item.title)}</div>
                <div class="desc">${escapeHtml(item.detail)}</div>
              </div>
              <div class="item-meta">${escapeHtml(formatTimeOnly(item.time))}</div>
            </div>`
        )
        .join("") || `<div class="section-note">Nothing to report yet.</div>`}
    </div>`;

  els.homeHighlights.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Upcoming Highlights</h3>
        <p class="panel-note">The next few moments AKIRA is keeping an eye on.</p>
      </div>
    </div>
    <div class="list">
      ${highlights
        .map(
          (item) => `
            <div class="highlight-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(item.label)}</div>
                <div class="status-chip">${escapeHtml(item.time)}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(item.detail)}</div>
            </div>`
        )
        .join("")}
    </div>`;

  els.homeAgents.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Active Agents</h3>
        <p class="panel-note">Real workflow roles mapped from the orchestration stages.</p>
      </div>
      <div class="status-chip">${escapeHtml(agents.length)} online</div>
    </div>
    <div class="compact-list">
      ${agents
        .slice(0, 5)
        .map(
          (agent) => `
            <div class="agent-item">
              <div class="item-row">
                <div>
                  <div class="item-title">${escapeHtml(agent.name)}</div>
                  <div class="item-subtitle">${escapeHtml(agent.subtitle)}</div>
                </div>
                <div class="status-chip ${escapeHtml(agent.status.toLowerCase())}">${escapeHtml(agent.status)}</div>
              </div>
              <div class="progress ${escapeHtml(agent.tone)}"><span style="width:${Math.max(10, Math.min(100, agent.progress))}%"></span></div>
            </div>`
        )
        .join("")}
    </div>`;

  els.homeAlerts.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Alerts</h3>
        <p class="panel-note">Health, usage, and workflow attention signals.</p>
      </div>
      <div class="status-chip">${escapeHtml(alerts.length)} active</div>
    </div>
    <div class="list">
      ${alerts
        .slice(0, 4)
        .map(
          (alert) => `
            <div class="alert-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(alert.title)}</div>
                <div class="status-chip ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(alert.detail)}</div>
            </div>`
        )
        .join("") || `<div class="section-note">No active alerts.</div>`}
    </div>`;

  if (monitoring?.usage?.summary) {
    const usage = monitoring.usage.summary;
    const detail = `${usage.requestCount ?? 0} requests • ${usage.totalTokens ?? 0} tokens • $${Number(usage.costUsd ?? 0).toFixed(4)}`;
    els.homeUpdates.insertAdjacentHTML("beforeend", `<div class="footer-note" style="margin-top:12px;">Usage window: ${escapeHtml(detail)}</div>`);
  }
}

function renderPodcastView() {
  const dashboard = state.dashboard || {};
  const task = selectedTask();
  const events = selectedTaskEvents();
  const artifact = selectedTaskArtifact(task) || dashboard.monitoring?.latestDigests?.[0]?.artifacts?.[0] || null;

  els.podcastTranscript.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Live Transcript</h3>
        <p class="panel-note">The currently selected task or live task stream.</p>
      </div>
      <div class="status-chip">${escapeHtml(events.length)} events</div>
    </div>
    <div class="timeline-feed">
      ${events
        .slice()
        .reverse()
        .map(
          (event) => `
            <div class="timeline-item ${escapeHtml(event.data?.audience || "machine")}">
              <div class="timeline-label">${escapeHtml(event.data?.audience || "machine")} • ${escapeHtml(event.data?.stage || "unknown stage")}</div>
              <div>${escapeHtml(event.data?.message || "")}</div>
            </div>`
        )
        .join("") || `<div class="section-note">No transcript available yet.</div>`}
    </div>`;

  els.podcastArtifact.innerHTML = artifact
    ? `
      <div class="panel-header">
        <div>
          <h3 class="panel-title">${escapeHtml(artifact.episodeTitle || artifact.headline || "Script Package")}</h3>
          <p class="panel-note">${escapeHtml(artifact.summary || artifact.headline || "Artifact ready for review.")}</p>
        </div>
      </div>
      <div class="script-view">
        ${artifact.scriptSections
          ? artifact.scriptSections
              .map(
                (section) => `
                  <div class="script-section">
                    <div class="item-title">${escapeHtml(section.heading)}</div>
                    ${(section.lines || [])
                      .map(
                        (line) => `
                          <div class="script-line">
                            ${escapeHtml(line.text)}
                            <span class="item-meta">[${escapeHtml((line.citations || []).join(", "))}]</span>
                          </div>`
                      )
                      .join("")}
                  </div>`
              )
              .join("")
          : `<div class="section-note">No script sections available.</div>`}
      </div>
      <div class="source-list">
        ${(artifact.sources || [])
          .map(
            (source) => `
              <div class="source-item">
                <div class="item-title">${escapeHtml(source.title)}</div>
                <div class="item-meta">${escapeHtml(source.source)}</div>
                <div class="source-url">${escapeHtml(source.url)}</div>
              </div>`
          )
          .join("") || `<div class="section-note">No sources available.</div>`}
      </div>`
    : `<div class="panel-header"><div><h3 class="panel-title">Artifact Bundle</h3><p class="panel-note">Start a task to generate the script package.</p></div></div>`;

  const audio = artifact?.audio || dashboard.hero?.audio;
  els.podcastAudio.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Playback</h3>
        <p class="panel-note">Audio output and voice session controls for the selected task.</p>
      </div>
    </div>
    <div class="hero-controls">
      <button class="hero-chip" id="podcast-summary">Ask summary</button>
      <button class="hero-chip" id="podcast-replay">Load replay</button>
      <button class="hero-chip" id="podcast-voice">${state.voiceEnabled ? "Voice on" : "Voice off"}</button>
      <button class="hero-chip" id="podcast-audio">${state.audioEnabled ? "Audio on" : "Audio off"}</button>
    </div>
    <div class="audio-block">
      ${
        audio?.base64Data
          ? `<audio controls preload="none" src="data:${escapeHtml(audio.mimeType || "audio/wav")};base64,${audio.base64Data}"></audio>`
          : `<div class="section-note">No playable audio artifact is attached to the current selection.</div>`
      }
    </div>`;
}

function renderTasksView() {
  const tasks = state.dashboard?.tasks || [];
  const task = selectedTask();
  els.tasksList.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Tasks</h3>
        <p class="panel-note">Browse the current backlog and pick a task to inspect.</p>
      </div>
      <div class="status-chip">${escapeHtml(tasks.length)} total</div>
    </div>
    <div class="compact-list" id="tasks-list-inner">
      ${tasks
        .map(
          (item) => `
            <button class="compact-item task-item ${item.taskId === state.selectedTaskId ? "selected" : ""}" data-task-id="${escapeHtml(item.taskId)}">
              <div>
                <div class="name">${escapeHtml(item.topic || item.taskId)}</div>
                <div class="desc">
                  ${escapeHtml(item.stage || "unknown stage")} • ${escapeHtml(item.updatedAt ? formatDateTime(item.updatedAt) : "")}
                  ${item.newsSchedule?.enabled ? `• every ${escapeHtml(item.newsSchedule.refreshEveryMinutes || 60)}m` : ""}
                </div>
              </div>
              <div style="display:grid; gap:8px; min-width:140px; justify-items:end;">
                <div class="status-chip ${escapeHtml(item.status)}">${escapeHtml(item.status)}</div>
                <div class="progress ${progressClass(task?.taskId === item.taskId ? task?.progress || 0 : item.progress || 0)}"><span style="width:${Math.max(5, Math.min(100, task?.taskId === item.taskId ? task?.progress || 0 : item.progress || 0))}%"></span></div>
              </div>
            </button>`
        )
        .join("") || `<div class="section-note">No tasks yet.</div>`}
    </div>`;

  const artifact = selectedTaskArtifact(task);
  els.taskDetail.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Task Detail</h3>
        <p class="panel-note">${escapeHtml(task?.topic || "Select a task to review its artifact bundle.")}</p>
      </div>
    </div>
    ${
      task
        ? `
      <div class="metric-grid">
        <div class="metric-box">
          <div class="metric-label">Task ID</div>
          <div class="metric-value">${escapeHtml(task.taskId)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Status</div>
          <div class="metric-value">${escapeHtml(task.status)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Stage</div>
          <div class="metric-value">${escapeHtml(task.stage || "waiting")}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Progress</div>
          <div class="metric-value">${escapeHtml(task.progress)}%</div>
        </div>
      </div>
      <div style="margin-top:14px;" class="progress ${progressClass(task.progress)}"><span style="width:${Math.max(5, Math.min(100, task.progress || 0))}%"></span></div>
      <div class="hero-controls" style="margin-top:14px;">
        <button class="hero-chip" id="task-summary">Ask summary</button>
        <button class="hero-chip" id="task-replay">Load replay</button>
        <button class="hero-chip" id="task-podcast">Open podcast</button>
      </div>
      ${renderNewsProfile(task)}
      <div class="script-view" style="margin-top:14px;">
        ${artifact
          ? (artifact.scriptSections || [])
              .map(
                (section) => `
                  <div class="script-section">
                    <div class="item-title">${escapeHtml(section.heading)}</div>
                    ${(section.lines || [])
                      .map(
                        (line) => `
                          <div class="script-line">${escapeHtml(line.text)} <span class="item-meta">[${escapeHtml((line.citations || []).join(", "))}]</span></div>`
                      )
                      .join("")}
                  </div>`
              )
              .join("")
          : `<div class="section-note">No artifact package is attached to this task yet.</div>`}
      </div>
      <div class="source-list">
        ${(artifact?.sources || [])
          .map(
            (source) => `
              <div class="source-item">
                <div class="item-title">${escapeHtml(source.title)}</div>
                <div class="item-meta">${escapeHtml(source.source)}</div>
                <div class="source-url">${escapeHtml(source.url)}</div>
              </div>`
          )
          .join("") || `<div class="section-note">No sources available.</div>`}
      </div>`
        : `<div class="section-note">No task selected.</div>`
    }`;
}

function renderAgentsView() {
  const agents = state.dashboard?.agents || [];
  const stages = state.dashboard?.monitoring ? [
    { label: "Source discovery", role: "source_discovery" },
    { label: "Normalization", role: "normalize_dedupe" },
    { label: "Ranking", role: "rank_cluster" },
    { label: "Structure drafting", role: "draft_structure" },
    { label: "Script drafting", role: "draft_script" },
    { label: "Citation validation", role: "citation_validator" },
    { label: "Show notes", role: "show_notes" },
  ] : [];

  els.agentsRoster.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Active Agents</h3>
        <p class="panel-note">Each row corresponds to a real bounded workflow role.</p>
      </div>
    </div>
    <div class="compact-list">
      ${agents
        .map(
          (agent) => `
            <div class="agent-item">
              <div class="item-row">
                <div>
                  <div class="item-title">${escapeHtml(agent.name)}</div>
                  <div class="item-subtitle">${escapeHtml(agent.subtitle)}</div>
                </div>
                <div class="status-chip ${escapeHtml(agent.status.toLowerCase())}">${escapeHtml(agent.status)}</div>
              </div>
              <div class="progress ${escapeHtml(agent.tone)}"><span style="width:${Math.max(10, Math.min(100, agent.progress))}%"></span></div>
            </div>`
        )
        .join("")}
    </div>`;

  els.agentsMap.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Workflow Map</h3>
        <p class="panel-note">The execution path AKIRA is moving through right now.</p>
      </div>
    </div>
    <div class="list">
      ${stages
        .map((stage, index) => {
          const match = agents.find((agent) => agent.stage === stage.role);
          const status = match?.status || "Idle";
          const progress = match?.progress ?? (index * 14 + 5);
          return `
            <div class="highlight-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(stage.label)}</div>
                <div class="status-chip ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(stage.role)}</div>
              <div class="progress ${progressClass(progress)}"><span style="width:${Math.max(8, Math.min(100, progress))}%"></span></div>
            </div>`;
        })
        .join("")}
    </div>`;
}

function renderAlertsView() {
  const alerts = state.dashboard?.alerts || [];
  const monitoring = state.dashboard?.monitoring || {};
  const modelRouter = state.dashboard?.modelRouter || {};
  const health = monitoring.health || {};
  const usage = monitoring.usage?.summary || {};
  const metrics = monitoring.metrics || {};

  els.alertsList.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Alerts</h3>
        <p class="panel-note">System health, workflow pauses, and monitoring warnings.</p>
      </div>
      <div class="status-chip">${escapeHtml(alerts.length)} active</div>
    </div>
    <div class="compact-list">
      ${alerts
        .map(
          (alert) => `
            <div class="alert-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(alert.title)}</div>
                <div class="status-chip ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(alert.detail)}</div>
              <div class="item-meta">${escapeHtml(alert.source)}</div>
            </div>`
        )
        .join("") || `<div class="section-note">No active alerts.</div>`}
    </div>`;

  els.alertsMonitoring.innerHTML = `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Monitoring Overview</h3>
        <p class="panel-note">Health, usage, model requests, and digest status.</p>
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric-box">
        <div class="metric-label">Usage window</div>
        <div class="metric-value">${escapeHtml(state.dashboard?.windowMinutes || 15)}m</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Request count</div>
        <div class="metric-value">${escapeHtml(usage.requestCount ?? 0)}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Total tokens</div>
        <div class="metric-value">${escapeHtml(usage.totalTokens ?? 0)}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Cost (USD)</div>
        <div class="metric-value">${Number(usage.costUsd ?? 0).toFixed(4)}</div>
      </div>
    </div>
    <div class="list" style="margin-top:14px;">
      ${Object.entries(health)
        .map(
          ([service, payload]) => `
            <div class="highlight-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(service)}</div>
                <div class="status-chip ${payload.ok ? "completed" : "failed"}">${payload.ok ? "healthy" : "degraded"}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(payload.error || payload.payload?.service || "ok")}</div>
              <div class="item-meta">memory ${Math.round(metrics?.[service]?.residentMemoryKb || 0)} KB</div>
            </div>`
        )
        .join("")}
    </div>
    <div class="highlight-item" style="margin-top:14px;">
      <div class="item-row">
        <div class="item-title">Model Router</div>
        <div class="status-chip ${modelRouter.url ? "completed" : "idle"}">${modelRouter.url ? "configured" : "local fallback"}</div>
      </div>
      <div class="item-subtitle">${escapeHtml(modelRouter.url || "Using the local model fallback router.")}</div>
      <div class="item-meta">auth ${escapeHtml(modelRouter.authMode || "none")} • default ${escapeHtml(modelRouter.defaultModel || "gpt-4.1-mini")} • source ${escapeHtml(modelRouter.source || "env")}</div>
    </div>
    <div class="digest-list" style="margin-top:14px;">
      ${(monitoring.latestDigests || [])
        .map(
          (item) => `
            <div class="highlight-item">
              <div class="item-row">
                <div class="item-title">${escapeHtml(item.artifacts?.[0]?.headline || "Monitoring digest")}</div>
                <div class="status-chip completed">${escapeHtml(item.task?.status || "completed")}</div>
              </div>
              <div class="item-subtitle">${escapeHtml(item.task?.updatedAt || "")}</div>
              ${
                item.artifacts?.[0]?.audio?.base64Data
                  ? `<audio controls preload="none" src="data:${escapeHtml(item.artifacts[0].audio.mimeType || "audio/wav")};base64,${item.artifacts[0].audio.base64Data}"></audio>`
                  : ""
              }
            </div>`
        )
        .join("")}
    </div>`;
}

function renderSidebarState() {
  const live = state.liveTaskId ? taskLookup(state.liveTaskId) : null;
  els.connectionBadge.textContent = live?.status || state.dashboard?.hero?.status || "Idle";
  els.voiceBadge.textContent = state.voiceEnabled ? "Voice on" : "Voice off";
  els.voiceBadge.classList.toggle("subtle", !state.voiceEnabled);
  els.audioToggle.textContent = state.audioEnabled ? "Audio On" : "Audio Off";
  els.voiceToggle.textContent = state.voiceEnabled ? "Wake On" : "Wake Word";
  els.runMonitoringDigest.textContent = "Run Digest";
}

function renderHeaderState() {
  const dashboard = state.dashboard || {};
  els.greetingLabel.textContent = timeGreeting();
  els.headline.textContent = dashboard.subtitle || "Here’s what your agents have been up to.";
  els.subheadline.textContent = "Live command center for podcast production, monitoring, and task orchestration.";
}

function renderAll() {
  if (!state.dashboard) return;
  const task = selectedTask();
  const selectedEvents = selectedTaskEvents();
  if (state.selectedTaskId && state.selectedTaskId === state.liveTaskId && state.dashboard.hero?.events) {
    state.liveEvents = state.dashboard.hero.events;
  }
  renderHeaderState();
  renderSidebarState();
  renderSummaryCards(state.dashboard.cards || []);
  renderHero();
  renderHomeView();
  renderPodcastView();
  renderTasksView();
  renderAgentsView();
  renderAlertsView();
  setView(state.activeView);
  if (task && state.selectedTaskReplayTaskId !== state.selectedTaskId && state.selectedTaskId !== state.liveTaskId) {
    loadTaskReplay(task.taskId).catch(console.error);
  }
  if (!selectedEvents.length && task?.taskId && task.taskId === state.liveTaskId) {
    state.liveEvents = state.dashboard.hero?.events || [];
  }
}

function bindHeroControls() {
  const heroNewTask = document.querySelector("#hero-new-task");
  const heroSummary = document.querySelector("#hero-summary");
  const heroReplay = document.querySelector("#hero-replay");
  const heroVoice = document.querySelector("#hero-voice-toggle");
  const heroAudio = document.querySelector("#hero-audio-toggle");

  heroNewTask?.addEventListener("click", () => createTask().catch(console.error));
  heroSummary?.addEventListener("click", () => taskAction("summary").catch(console.error));
  heroReplay?.addEventListener("click", () => loadReplay().catch(console.error));
  heroVoice?.addEventListener("click", () => toggleVoice());
  heroAudio?.addEventListener("click", () => toggleAudio());
}

async function loadDashboard() {
  const overview = await api("/dashboard/overview");
  state.dashboard = overview;
  const liveTaskId = overview.hero?.task?.taskId || null;
  state.liveTaskId = liveTaskId;
  if (!state.selectedTaskId || !taskLookup(state.selectedTaskId)) {
    state.selectedTaskId = liveTaskId || overview.tasks?.[0]?.taskId || null;
  }
  if (state.selectedTaskId === liveTaskId) {
    state.liveEvents = overview.hero?.events || [];
  }
  renderAll();
  if (liveTaskId && state.connectedTaskId !== liveTaskId) {
    connectEvents(liveTaskId);
    state.connectedTaskId = liveTaskId;
  } else if (!liveTaskId && state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
    state.connectedTaskId = null;
  }
}

async function loadTaskReplay(taskId) {
  if (!taskId) return;
  state.selectedTaskReplayTaskId = taskId;
  const replay = await api(`/tasks/${taskId}/replay`);
  state.selectedTaskReplay = replay.events || [];
  renderAll();
}

function openTaskComposer(prefill = {}) {
  if (!els.newsTaskModal || !els.newsTaskForm) return;
  state.newsComposerOpen = true;
  const topicInput = els.newsTaskForm.querySelector('[name="topic"]');
  const keywordsInput = els.newsTaskForm.querySelector('[name="focusKeywords"]');
  const exclusionsInput = els.newsTaskForm.querySelector('[name="exclusions"]');
  const entitiesInput = els.newsTaskForm.querySelector('[name="entities"]');
  const sourcePreferencesInput = els.newsTaskForm.querySelector('[name="sourcePreferences"]');
  const freshnessInput = els.newsTaskForm.querySelector('[name="freshnessWindowMinutes"]');
  const refreshInput = els.newsTaskForm.querySelector('[name="refreshEveryMinutes"]');
  const scheduleEnabledInput = els.newsTaskForm.querySelector('[name="scheduleEnabled"]');

  topicInput.value = prefill.topic || "multi agent platform news, voice interfaces, storage mcp, orchestration";
  keywordsInput.value = prefill.focusKeywords || "agents, orchestration, voice";
  exclusionsInput.value = prefill.exclusions || "";
  entitiesInput.value = prefill.entities || "";
  sourcePreferencesInput.value = prefill.sourcePreferences || "official docs, product updates, reputable news";
  freshnessInput.value = prefill.freshnessWindowMinutes || 240;
  refreshInput.value = prefill.refreshEveryMinutes || 60;
  scheduleEnabledInput.checked = prefill.scheduleEnabled ?? true;
  els.newsTaskModal.classList.add("open");
  els.newsTaskModal.setAttribute("aria-hidden", "false");
  setTimeout(() => topicInput.focus(), 0);
}

function closeTaskComposer() {
  if (!els.newsTaskModal) return;
  state.newsComposerOpen = false;
  els.newsTaskModal.classList.remove("open");
  els.newsTaskModal.setAttribute("aria-hidden", "true");
}

async function submitTaskComposer(event) {
  event.preventDefault();
  if (!els.newsTaskForm) return;
  const payload = buildNewsTaskPayload(new FormData(els.newsTaskForm));
  if (!payload.topic) return;
  const created = await api("/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.selectedTaskId = created.taskId;
  state.activeView = "podcast";
  closeTaskComposer();
  await loadDashboard();
}

async function createTask() {
  openTaskComposer();
}

async function taskAction(action, extra = {}) {
  const task = selectedTask();
  if (!task) return;
  await api(`/tasks/${task.taskId}/interrupt`, {
    method: "POST",
    body: JSON.stringify({ action, ...extra }),
  });
  await loadDashboard();
  if (task.taskId !== state.liveTaskId) {
    await loadTaskReplay(task.taskId);
  }
}

async function loadReplay() {
  const task = selectedTask();
  if (!task) return;
  await loadTaskReplay(task.taskId);
}

async function runMonitoringDigest() {
  const result = await api("/monitoring/digests/run", {
    method: "POST",
    body: JSON.stringify({ windowMinutes: 15 }),
  });
  state.selectedTaskId = result?.task?.taskId || state.selectedTaskId;
  state.activeView = "alerts";
  await loadDashboard();
}

function sendVoiceCommand(commandText) {
  if (!state.voiceSocket || state.voiceSocket.readyState !== WebSocket.OPEN) {
    ensureVoiceSocket();
  }
  state.voiceSocket?.send(JSON.stringify({ type: "voice.command", text: commandText, taskId: state.selectedTaskId }));
}

function ensureVoiceSocket() {
  if (state.voiceSocket && state.voiceSocket.readyState === WebSocket.OPEN) {
    return state.voiceSocket;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.voiceSocket = new WebSocket(`${protocol}//${window.location.host}/ws/voice`);
  state.voiceSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.result?.taskId) {
      state.selectedTaskId = payload.result.taskId;
      state.activeView = "podcast";
      loadDashboard().catch(console.error);
      loadTaskReplay(payload.result.taskId).catch(console.error);
    }
  });
  return state.voiceSocket;
}

function startRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }
  if (state.recognition) {
    state.recognition.stop();
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results[event.results.length - 1][0].transcript;
    if (!/akira/i.test(text)) return;
    sendVoiceCommand(text);
  };
  recognition.onend = () => {
    if (state.voiceEnabled) {
      recognition.start();
    }
  };
  recognition.start();
  state.recognition = recognition;
}

function toggleVoice() {
  state.voiceEnabled = !state.voiceEnabled;
  if (state.voiceEnabled) {
    ensureVoiceSocket();
    startRecognition();
  } else if (state.recognition) {
    state.recognition.stop();
  }
  renderSidebarState();
}

function toggleAudio() {
  state.audioEnabled = !state.audioEnabled;
  if (!state.audioEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  renderSidebarState();
  renderHero();
  renderPodcastView();
}

function connectEvents(taskId) {
  if (!taskId) return;
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(`/api/tasks/${taskId}/events`);
  state.eventSource.addEventListener("machine", () => loadDashboard().catch(console.error));
  state.eventSource.addEventListener("narrative", () => loadDashboard().catch(console.error));
}

function bindGlobalListeners() {
  for (const item of els.navItems) {
    item.addEventListener("click", () => {
      state.activeView = item.dataset.view;
      setView(state.activeView);
    });
  }

  els.createTask.addEventListener("click", () => createTask().catch(console.error));
  els.runMonitoringDigest.addEventListener("click", () => runMonitoringDigest().catch(console.error));
  els.voiceToggle.addEventListener("click", () => toggleVoice());
  els.audioToggle.addEventListener("click", () => toggleAudio());
  els.newsTaskForm?.addEventListener("submit", (event) => submitTaskComposer(event).catch(console.error));
  for (const button of els.newsTaskCloseButtons) {
    button.addEventListener("click", () => closeTaskComposer());
  }
  els.newsTaskModal?.addEventListener("click", (event) => {
    if (event.target === els.newsTaskModal || event.target.closest("[data-close-task-modal]")) {
      closeTaskComposer();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.newsComposerOpen) {
      closeTaskComposer();
    }
  });

  els.tasksList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-task-id]");
    if (!item) return;
    const taskId = item.dataset.taskId;
    state.selectedTaskId = taskId;
    state.activeView = "podcast";
    renderAll();
  });

  els.podcastAudio.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.id === "podcast-summary") {
      taskAction("summary").catch(console.error);
    }
    if (target.id === "podcast-replay") {
      loadReplay().catch(console.error);
    }
    if (target.id === "podcast-voice") {
      toggleVoice();
    }
    if (target.id === "podcast-audio") {
      toggleAudio();
    }
  });

  els.taskDetail.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.id === "task-summary") {
      taskAction("summary").catch(console.error);
    }
    if (target.id === "task-replay") {
      loadReplay().catch(console.error);
    }
    if (target.id === "task-podcast") {
      state.activeView = "podcast";
      setView(state.activeView);
    }
  });
}

function bootstrap() {
  bindGlobalListeners();
  loadDashboard().catch(console.error);
  setInterval(() => loadDashboard().catch(() => {}), 4000);
}

export function interpretCommand(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized.includes("akira")) {
    return null;
  }
  if (normalized.includes("pause")) return { action: "pause" };
  if (normalized.includes("resume")) return { action: "resume" };
  if (normalized.includes("interrupt") || normalized.includes("stop")) return { action: "interrupt" };
  if (normalized.includes("summary") || normalized.includes("status")) return { action: "summary" };
  if (normalized.includes("priority")) {
    const priority = normalized.includes("high") ? "high" : normalized.includes("low") ? "low" : "normal";
    return { action: "reprioritize", priority };
  }
  if (normalized.includes("start")) {
    const topic = text.replace(/akira/i, "").replace(/start/i, "").trim();
    return { action: "start", topic };
  }
  return { action: "summary" };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap();
}
