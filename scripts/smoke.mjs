const baseDashboard = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";
const baseOrchestrator = process.env.ORCHESTRATOR_URL || "http://127.0.0.1:9000";
const baseStorage = process.env.STORAGE_URL || "http://127.0.0.1:9100";

async function json(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function main() {
  console.log(await json(`${baseStorage}/health`));
  console.log(await json(`${baseOrchestrator}/health`));
  console.log(await json(`${baseDashboard}/health`));

  const task = await json(`${baseOrchestrator}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "multi agent platform and voice interfaces" }),
  });
  console.log("created", task.taskId);

  await new Promise((resolve) => setTimeout(resolve, 7000));
  const status = await json(`${baseOrchestrator}/v1/tasks/${task.taskId}/status`);
  console.log(status);
  const replay = await json(`${baseOrchestrator}/v1/tasks/${task.taskId}/replay`);
  console.log(`events: ${replay.events.length}`);

  const digest = await json(`${baseOrchestrator}/v1/monitoring/digests/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ windowMinutes: 15 }),
  });
  console.log("monitoring digest", digest.task.taskId);
  const overview = await json(`${baseOrchestrator}/v1/monitoring/overview`);
  console.log(`monitoring digests: ${overview.latestDigests.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
