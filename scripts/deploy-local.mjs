import { spawn } from "node:child_process";

const urls = {
  storage: process.env.STORAGE_URL || "http://127.0.0.1:9100",
  orchestrator: process.env.ORCHESTRATOR_URL || "http://127.0.0.1:9000",
  dashboard: process.env.DASHBOARD_URL || "http://127.0.0.1:3000",
  agentRuntime: process.env.AGENT_RUNTIME_URL || "http://127.0.0.1:8081",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 120000;
    const spawnOptions = { ...options };
    delete spawnOptions.timeoutMs;

    console.log(`\n$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...spawnOptions,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `${command} ${args.join(" ")} timed out after ${Math.round(timeoutMs / 1000)}s. ` +
              "If this happened during Docker startup, Docker Desktop may be wedged before containers can run.",
          ),
        );
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
      }
    });
  });
}

async function waitForHealth(name, baseUrl, timeoutMs = 120000) {
  const started = Date.now();
  const healthUrl = `${baseUrl.replace(/\/$/, "")}/health`;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.log(`${name} healthy at ${healthUrl}`, payload);
        return;
      }
    } catch {
      // Service is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${name} did not become healthy at ${healthUrl}`);
}

async function main() {
  console.log("AKIRA local orchestrated deployment starting with default config.");
  await run("npm", ["run", "k8s:generate"]);
  await run("docker", ["compose", "build"], { timeoutMs: 900000 });
  await run("docker", ["compose", "up", "-d"], { timeoutMs: 90000 });

  await Promise.all([
    waitForHealth("storage", urls.storage),
    waitForHealth("orchestrator", urls.orchestrator),
    waitForHealth("dashboard", urls.dashboard),
    waitForHealth("agent-runtime", urls.agentRuntime),
  ]);

  await run("npm", ["run", "smoke"]);
  console.log("\nAKIRA local orchestrated deployment completed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
