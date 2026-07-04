const state = {
  taskId: null,
  eventSource: null,
  voiceSocket: null,
  recognition: null,
  voiceEnabled: false,
  audioEnabled: true,
  monitoringOverview: null,
};

const els = {
  topicInput: document.querySelector("#topic-input"),
  createTask: document.querySelector("#create-task"),
  pauseTask: document.querySelector("#pause-task"),
  resumeTask: document.querySelector("#resume-task"),
  interruptTask: document.querySelector("#interrupt-task"),
  summaryTask: document.querySelector("#summary-task"),
  replayTask: document.querySelector("#replay-task"),
  voiceToggle: document.querySelector("#voice-toggle"),
  audioToggle: document.querySelector("#audio-toggle"),
  connectionBadge: document.querySelector("#connection-badge"),
  voiceBadge: document.querySelector("#voice-badge"),
  taskId: document.querySelector("#task-id"),
  taskStatus: document.querySelector("#task-status"),
  taskStage: document.querySelector("#task-stage"),
  taskProgress: document.querySelector("#task-progress"),
  timeline: document.querySelector("#timeline"),
  voiceLog: document.querySelector("#voice-log"),
  currentSpeaker: document.querySelector("#current-speaker"),
  artifactTitle: document.querySelector("#artifact-title"),
  artifactSummary: document.querySelector("#artifact-summary"),
  artifactScript: document.querySelector("#artifact-script"),
  sourceList: document.querySelector("#source-list"),
  usageWindow: document.querySelector("#usage-window"),
  logSource: document.querySelector("#log-source"),
  usageRequests: document.querySelector("#usage-requests"),
  usageTokens: document.querySelector("#usage-tokens"),
  usageCost: document.querySelector("#usage-cost"),
  serviceHealth: document.querySelector("#service-health"),
  monitoringDigests: document.querySelector("#monitoring-digests"),
  runMonitoringDigest: document.querySelector("#run-monitoring-digest"),
};

function appendVoiceLog(text) {
  const line = document.createElement("div");
  line.textContent = text;
  els.voiceLog.prepend(line);
}

function appendTimeline(event) {
  const item = document.createElement("div");
  item.className = `timeline-item ${event.data.audience}`;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = `${event.data.audience} • ${event.data.stage}`;
  const body = document.createElement("div");
  body.textContent = event.data.message;
  item.append(label, body);
  els.timeline.prepend(item);
  if (event.data.audience === "narrative") {
    els.currentSpeaker.textContent = event.data.message;
    if (state.audioEnabled && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(event.data.message);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function refreshTask() {
  if (!state.taskId) return;
  const status = await api(`/tasks/${state.taskId}/status`);
  els.taskId.textContent = status.taskId;
  els.taskStatus.textContent = status.status;
  els.taskStage.textContent = status.stage;
  els.taskProgress.textContent = `${status.progress}%`;
  els.connectionBadge.textContent = status.status;
  const task = await api(`/tasks/${state.taskId}`);
  renderArtifact(task.artifacts?.[0]);
}

function renderMonitoringOverview(overview) {
  state.monitoringOverview = overview;
  els.usageWindow.textContent = `${overview.windowMinutes}m`;
  els.logSource.textContent = overview.logSource || "local";
  els.usageRequests.textContent = String(overview.usage.summary.requestCount ?? 0);
  els.usageTokens.textContent = String(overview.usage.summary.totalTokens ?? 0);
  els.usageCost.textContent = Number(overview.usage.summary.costUsd ?? 0).toFixed(6);

  els.serviceHealth.innerHTML = "";
  for (const [service, payload] of Object.entries(overview.health || {})) {
    const metrics = overview.metrics?.[service] || {};
    const item = document.createElement("div");
    item.className = "health-item";
    const stateClass = payload.ok ? "health-state" : "health-state degraded";
    item.innerHTML = `
      <strong>${service}</strong>
      <div class="${stateClass}">${payload.ok ? "healthy" : "degraded"}</div>
      <div class="digest-meta">memory: ${Math.round(metrics.residentMemoryKb || 0)} KB • errors: ${Math.round(metrics.errorCount || 0)}</div>
    `;
    els.serviceHealth.append(item);
  }

  els.monitoringDigests.innerHTML = "";
  for (const item of overview.latestDigests || []) {
    const artifact = item.artifacts?.[0];
    const task = item.task;
    const node = document.createElement("div");
    node.className = "digest-item";
    const transcript = artifact?.audio?.transcript || artifact?.script || "Monitoring digest ready.";
    const audioSource = artifact?.audio?.base64Data
      ? `data:${artifact.audio.mimeType || "audio/wav"};base64,${artifact.audio.base64Data}`
      : "";
    node.innerHTML = `
      <strong>${artifact?.headline || "Monitoring digest"}</strong>
      <div class="digest-meta">${task?.updatedAt || ""} • ${artifact?.audio?.mode || "audio-first"} • ${artifact?.audio?.status || ""} • ${task?.status || ""}</div>
      <div>${transcript}</div>
      ${audioSource ? `<audio class="digest-audio" controls preload="none" src="${audioSource}"></audio>` : ""}
    `;
    els.monitoringDigests.append(node);
  }
}

async function refreshMonitoringOverview() {
  try {
    const overview = await api("/monitoring/overview");
    renderMonitoringOverview(overview);
  } catch (error) {
    console.error(error);
  }
}

function renderArtifact(artifact) {
  if (!artifact) {
    return;
  }
  els.artifactTitle.textContent = artifact.episodeTitle || "Script Package";
  els.artifactSummary.textContent = artifact.summary || "Artifact ready";
  els.artifactScript.innerHTML = "";
  for (const section of artifact.scriptSections || []) {
    const block = document.createElement("div");
    block.className = "script-section";
    const heading = document.createElement("strong");
    heading.textContent = section.heading;
    block.append(heading);
    for (const line of section.lines || []) {
      const item = document.createElement("div");
      item.className = "script-line";
      item.textContent = `${line.text} [${line.citations.join(", ")}]`;
      block.append(item);
    }
    els.artifactScript.append(block);
  }
  els.sourceList.innerHTML = "";
  for (const source of artifact.sources || []) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${source.title}</strong><div class="muted">${source.source}</div><div>${source.url}</div>`;
    els.sourceList.append(li);
  }
}

function connectEvents(taskId) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(`/api/tasks/${taskId}/events`);
  state.eventSource.addEventListener("machine", (message) => {
    appendTimeline(JSON.parse(message.data));
    refreshTask().catch(console.error);
  });
  state.eventSource.addEventListener("narrative", (message) => {
    appendTimeline(JSON.parse(message.data));
    refreshTask().catch(console.error);
  });
}

async function createTask() {
  const payload = await api("/tasks", {
    method: "POST",
    body: JSON.stringify({ topic: els.topicInput.value.trim() }),
  });
  state.taskId = payload.taskId;
  connectEvents(state.taskId);
  refreshTask();
}

async function taskAction(action, extra = {}) {
  if (!state.taskId) return;
  await api(`/tasks/${state.taskId}/interrupt`, {
    method: "POST",
    body: JSON.stringify({ action, ...extra }),
  });
  refreshTask();
}

async function loadReplay() {
  if (!state.taskId) return;
  const replay = await api(`/tasks/${state.taskId}/replay`);
  els.timeline.innerHTML = "";
  [...replay.events].reverse().forEach(appendTimeline);
}

async function runMonitoringDigest() {
  const result = await api("/monitoring/digests/run", {
    method: "POST",
    body: JSON.stringify({ windowMinutes: 15 }),
  });
  renderMonitoringOverview(await api("/monitoring/overview"));
  if (result?.task?.taskId) {
    appendVoiceLog(`Monitoring digest generated: ${result.task.taskId}`);
  }
}

function ensureVoiceSocket() {
  if (state.voiceSocket && state.voiceSocket.readyState === WebSocket.OPEN) {
    return state.voiceSocket;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.voiceSocket = new WebSocket(`${protocol}//${window.location.host}/ws/voice`);
  state.voiceSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    appendVoiceLog(`Server: ${payload.ok ? "accepted" : payload.error}`);
    if (payload.result?.taskId) {
      state.taskId = payload.result.taskId;
      connectEvents(state.taskId);
      refreshTask();
    }
  });
  return state.voiceSocket;
}

function startRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    appendVoiceLog("Speech recognition is not available in this browser.");
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
    appendVoiceLog(`Heard: ${text}`);
    if (!/akira/i.test(text)) return;
    ensureVoiceSocket().send(JSON.stringify({ type: "voice.command", text, taskId: state.taskId }));
  };
  recognition.onend = () => {
    if (state.voiceEnabled) {
      recognition.start();
    }
  };
  recognition.start();
  state.recognition = recognition;
}

els.createTask.addEventListener("click", () => createTask().catch(console.error));
els.pauseTask.addEventListener("click", () => taskAction("pause").catch(console.error));
els.resumeTask.addEventListener("click", () => taskAction("resume").catch(console.error));
els.interruptTask.addEventListener("click", () => taskAction("interrupt").catch(console.error));
els.summaryTask.addEventListener("click", () => taskAction("summary").catch(console.error));
els.replayTask.addEventListener("click", () => loadReplay().catch(console.error));
els.voiceToggle.addEventListener("click", () => {
  state.voiceEnabled = !state.voiceEnabled;
  els.voiceBadge.textContent = state.voiceEnabled ? "Voice on" : "Voice off";
  if (state.voiceEnabled) {
    ensureVoiceSocket();
    startRecognition();
  } else if (state.recognition) {
    state.recognition.stop();
  }
});
els.runMonitoringDigest.addEventListener("click", () => runMonitoringDigest().catch(console.error));
els.audioToggle.addEventListener("click", () => {
  state.audioEnabled = !state.audioEnabled;
  els.audioToggle.textContent = state.audioEnabled ? "Audio On" : "Audio Off";
  if (!state.audioEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});

setInterval(() => {
  refreshTask().catch(() => {});
  refreshMonitoringOverview().catch(() => {});
}, 2500);

refreshMonitoringOverview().catch(() => {});
