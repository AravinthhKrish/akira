import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildKubernetesDocuments,
  parseSimpleYaml,
  renderKubernetesYaml,
} from "./generate-k8s.mjs";

test("single AKIRA config drives service selection and dependency env", async () => {
  const source = await readFile(new URL("../config/akira.yaml", import.meta.url), "utf-8");
  const config = parseSimpleYaml(source);
  const documents = buildKubernetesDocuments(config);
  const rendered = renderKubernetesYaml(config);

  const names = documents.map((document) => document.metadata?.name).filter(Boolean);
  const orchestrator = documents.find((document) => document.kind === "Deployment" && document.metadata.name === "akira-orchestrator");
  const storage = documents.find((document) => document.kind === "Deployment" && document.metadata.name === "storagemcp-platform");
  const agentRuntime = documents.find((document) => document.kind === "Deployment" && document.metadata.name === "agent-runtime");
  const storageClaim = documents.find((document) => document.kind === "PersistentVolumeClaim" && document.metadata.name === "storagemcp-platform-data");

  assert.equal(config.platform.namespace, "akira");
  assert.ok(names.includes("agent-runtime"));
  assert.ok(names.includes("mcp-server-generic"));
  assert.ok(names.includes("nats-jetstream"));
  assert.ok(storageClaim);

  const orchestratorEnv = orchestrator.spec.template.spec.containers[0].env;
  assert.ok(orchestratorEnv.some((item) => item.name === "STORAGE_URL" && item.value === "http://storagemcp-platform:9100"));
  assert.ok(orchestratorEnv.some((item) => item.name === "MODEL_ROUTER_DEFAULT_MODEL" && item.value === "gpt-4.1-mini"));
  assert.ok(orchestratorEnv.some((item) => item.name === "NATS_URL" && item.value === "nats://nats-jetstream:4222"));
  assert.ok(orchestratorEnv.some((item) => item.name === "MCP_FALLBACK_ON_ERROR" && item.value === "true"));

  const agentRuntimeEnv = agentRuntime.spec.template.spec.containers[0].env;
  assert.ok(agentRuntimeEnv.some((item) => item.name === "SERVER_PORT" && item.value === "8081"));

  const storageContainer = storage.spec.template.spec.containers[0];
  assert.ok(storageContainer.volumeMounts.some((item) => item.name === "storage-data"));
  assert.match(rendered, /kind: "Deployment"/);
  assert.match(rendered, /name: "akira-orchestrator"/);
});

test("disabled services are not emitted", () => {
  const config = parseSimpleYaml(`
platform:
  name: akira
  namespace: akira-test
dependencies:
  api:
    orchestratorUrl: http://akira-orchestrator:9000
    storageUrl: http://storagemcp-platform:9100
    agentRuntimeUrl: http://agent-runtime:8081
    mcpServerUrl: http://mcp-server-generic:8080
  db:
    backend: mongo
  llm:
    defaultModel: gpt-4.1-mini
services:
  dashboard:
    enabled: false
    name: akira-dashboard
    image: akira-dashboard:latest
    port: 3000
  orchestrator:
    enabled: true
    name: akira-orchestrator
    image: akira-orchestrator:latest
    port: 9000
  storageMcpPlatform:
    enabled: false
    name: storagemcp-platform
    image: storagemcp-platform:latest
    port: 9100
`);

  const documents = buildKubernetesDocuments(config);
  const names = documents.map((document) => document.metadata?.name).filter(Boolean);

  assert.ok(names.includes("akira-orchestrator"));
  assert.ok(!names.includes("akira-dashboard"));
  assert.ok(!names.includes("storagemcp-platform"));
  assert.ok(!names.includes("storagemcp-platform-data"));
});
