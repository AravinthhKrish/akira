import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(repoRoot, "config", "akira.yaml");
const defaultOutputPath = path.join(repoRoot, "k8s", "generated", "akira.yaml");

function parseScalar(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

export function parseSimpleYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = source.split(/\r?\n/);

  for (const originalLine of lines) {
    const line = stripComment(originalLine).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const content = line.trim();
    const separator = content.indexOf(":");
    if (separator === -1) {
      throw new Error(`Unsupported YAML line: ${originalLine}`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    const key = content.slice(0, separator).trim();
    const rawValue = content.slice(separator + 1).trim();

    if (!key) {
      throw new Error(`YAML key is empty: ${originalLine}`);
    }
    if (rawValue === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }

  return root;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

export function toYaml(value, indent = 0) {
  const spaces = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${spaces}[]`;
    return value
      .map((item) => {
        if (isPlainObject(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) return `${spaces}- {}`;
          const [firstKey, firstValue] = entries[0];
          const firstLine = isPlainObject(firstValue) || Array.isArray(firstValue)
            ? `${spaces}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}`
            : `${spaces}- ${firstKey}: ${yamlScalar(firstValue)}`;
          const rest = entries
            .slice(1)
            .map(([key, nested]) => {
              if (isPlainObject(nested) || Array.isArray(nested)) {
                return `${" ".repeat(indent + 2)}${key}:\n${toYaml(nested, indent + 4)}`;
              }
              return `${" ".repeat(indent + 2)}${key}: ${yamlScalar(nested)}`;
            });
          return [firstLine, ...rest].join("\n");
        }
        return `${spaces}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([key, nested]) => {
        if (isPlainObject(nested) || Array.isArray(nested)) {
          return `${spaces}${key}:\n${toYaml(nested, indent + 2)}`;
        }
        return `${spaces}${key}: ${yamlScalar(nested)}`;
      })
      .join("\n");
  }
  return `${spaces}${yamlScalar(value)}`;
}

function enabled(service) {
  return Boolean(service?.enabled);
}

function cleanEnv(env) {
  return env.filter((item) => {
    if (item.valueFrom) return true;
    return item.value !== undefined && item.value !== null && String(item.value) !== "";
  });
}

function envValue(name, value) {
  return { name, value: String(value) };
}

function secretEnv(name, secretName, secretKey) {
  if (!secretName || !secretKey) return null;
  return {
    name,
    valueFrom: {
      secretKeyRef: {
        name: secretName,
        key: secretKey,
        optional: true,
      },
    },
  };
}

function labels(platform, appName) {
  return {
    app: appName,
    "app.kubernetes.io/name": appName,
    "app.kubernetes.io/part-of": platform.name,
    "app.kubernetes.io/managed-by": "akira-config-generator",
  };
}

function deployment(platform, service, container) {
  const appLabels = labels(platform, service.name);
  const podSpec = {
    containers: [
      {
        name: container.name,
        image: service.image,
        imagePullPolicy: platform.imagePullPolicy || "IfNotPresent",
        ports: container.ports.map((port) => ({ containerPort: port.targetPort || port.port })),
        env: cleanEnv(container.env || []),
      },
    ],
  };

  if (container.args?.length) {
    podSpec.containers[0].args = container.args;
  }
  if (container.volumeMounts?.length) {
    podSpec.containers[0].volumeMounts = container.volumeMounts;
  }
  if (container.volumes?.length) {
    podSpec.volumes = container.volumes;
  }

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: service.name,
      namespace: platform.namespace,
      labels: appLabels,
    },
    spec: {
      replicas: Number(service.replicas || 1),
      selector: { matchLabels: { app: service.name } },
      template: {
        metadata: { labels: appLabels },
        spec: podSpec,
      },
    },
  };
}

function kubernetesService(platform, service, ports) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: service.name,
      namespace: platform.namespace,
      labels: labels(platform, service.name),
    },
    spec: {
      selector: { app: service.name },
      ports: ports.map((port) => ({
        name: port.name || "http",
        port: Number(port.port),
        targetPort: Number(port.targetPort || port.port),
      })),
    },
  };
}

function pvc(platform, name, storageSize, storageClassName) {
  const spec = {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: storageSize || "5Gi",
      },
    },
  };
  if (storageClassName) {
    spec.storageClassName = storageClassName;
  }
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name,
      namespace: platform.namespace,
      labels: labels(platform, name),
    },
    spec,
  };
}

function namespace(platform) {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: platform.namespace,
      labels: {
        "app.kubernetes.io/part-of": platform.name,
        "app.kubernetes.io/managed-by": "akira-config-generator",
      },
    },
  };
}

function configMap(platform, config) {
  const api = config.dependencies?.api || {};
  const db = config.dependencies?.db || {};
  const llm = config.dependencies?.llm || {};
  const observability = config.dependencies?.observability || {};
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `${platform.name}-runtime-config`,
      namespace: platform.namespace,
      labels: labels(platform, `${platform.name}-runtime-config`),
    },
    data: {
      DASHBOARD_URL: String(api.dashboardUrl || ""),
      ORCHESTRATOR_URL: String(api.orchestratorUrl || ""),
      STORAGE_URL: String(api.storageUrl || ""),
      AGENT_RUNTIME_URL: String(api.agentRuntimeUrl || ""),
      MCP_SERVER_URL: String(api.mcpServerUrl || ""),
      NATS_URL: String(api.natsUrl || ""),
      STORAGE_BACKEND: String(db.backend || "disk"),
      STORAGE_DATA_DIR: String(db.storageDataDir || "/app/data/storage"),
      MODEL_ROUTER_URL: String(llm.modelRouterUrl || ""),
      MODEL_ROUTER_AUTH_MODE: String(llm.authMode || "none"),
      MODEL_ROUTER_DEFAULT_MODEL: String(llm.defaultModel || "gpt-4.1-mini"),
      ELASTICSEARCH_URL: String(observability.elasticsearchUrl || ""),
      ELASTIC_LOG_INDEX_PATTERN: String(observability.elasticLogIndexPattern || "akira-service-logs-*"),
    },
  };
}

function modelRouterEnv(llm = {}) {
  const env = [
    envValue("MODEL_ROUTER_URL", llm.modelRouterUrl || ""),
    envValue("MODEL_ROUTER_AUTH_MODE", llm.authMode || "none"),
    envValue("MODEL_ROUTER_AUTH_HEADER_NAME", llm.authHeaderName || "Authorization"),
    envValue("MODEL_ROUTER_DEFAULT_MODEL", llm.defaultModel || "gpt-4.1-mini"),
    envValue("MODEL_ROUTER_TIMEOUT_SECONDS", llm.timeoutSeconds || 15),
    envValue("MODEL_ROUTER_ROLE_MODELS_JSON", llm.roleModelsJson || "{}"),
    envValue("MODEL_ROUTER_STAGE_MODELS_JSON", llm.stageModelsJson || "{}"),
    envValue("MODEL_ROUTER_TASK_TYPE_MODELS_JSON", llm.taskTypeModelsJson || "{}"),
  ];
  if (llm.authMode === "bearer") {
    env.push(secretEnv("MODEL_ROUTER_BEARER_TOKEN", llm.bearerTokenSecretName, llm.bearerTokenSecretKey));
  }
  if (llm.authMode === "basic") {
    env.push(secretEnv("MODEL_ROUTER_BASIC_USERNAME", llm.basicUsernameSecretName, llm.basicUsernameSecretKey));
    env.push(secretEnv("MODEL_ROUTER_BASIC_PASSWORD", llm.basicPasswordSecretName, llm.basicPasswordSecretKey));
  }
  if (llm.authMode === "header") {
    env.push(secretEnv("MODEL_ROUTER_HEADER_VALUE", llm.headerValueSecretName, llm.headerValueSecretKey));
  }
  return env.filter(Boolean);
}

function serviceDocs(config, serviceKey, containerName, ports, env, extra = {}) {
  const platform = config.platform;
  const service = config.services?.[serviceKey];
  if (!enabled(service)) return [];
  const docs = [
    deployment(platform, service, {
      name: containerName,
      ports,
      env,
      args: extra.args,
      volumes: extra.volumes,
      volumeMounts: extra.volumeMounts,
    }),
  ];
  if (ports.length > 0) {
    docs.push(kubernetesService(platform, service, ports));
  }
  return docs;
}

export function buildKubernetesDocuments(config) {
  const platform = config.platform || {};
  const dependencies = config.dependencies || {};
  const api = dependencies.api || {};
  const db = dependencies.db || {};
  const llm = dependencies.llm || {};
  const observability = dependencies.observability || {};
  const services = config.services || {};
  const documents = [namespace(platform), configMap(platform, config)];

  const storageService = services.storageMcpPlatform;
  if (enabled(storageService) && db.backend === "disk") {
    documents.push(pvc(platform, `${storageService.name}-data`, db.storageSize, db.storageClassName));
  }

  documents.push(
    ...serviceDocs(
      config,
      "dashboard",
      "dashboard",
      [{ name: "http", port: services.dashboard?.port || 3000 }],
      [
        envValue("PORT", services.dashboard?.port || 3000),
        envValue("ORCHESTRATOR_URL", api.orchestratorUrl),
        envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir),
      ],
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "storageMcpPlatform",
      "storage",
      [{ name: "http", port: storageService?.port || 9100 }],
      [
        envValue("PORT", storageService?.port || 9100),
        envValue("STORAGE_BACKEND", db.backend || "disk"),
        envValue("STORAGE_DATA_DIR", db.storageDataDir || "/app/data/storage"),
        envValue("MONGODB_URL", db.mongodbUrl || ""),
        envValue("WEAVIATE_URL", db.weaviateUrl || ""),
        envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir),
      ],
      enabled(storageService) && db.backend === "disk"
        ? {
            volumes: [
              {
                name: "storage-data",
                persistentVolumeClaim: {
                  claimName: `${storageService.name}-data`,
                },
              },
            ],
            volumeMounts: [
              {
                name: "storage-data",
                mountPath: db.storageDataDir || "/app/data/storage",
              },
            ],
          }
        : {},
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "agentRuntime",
      "agent-runtime",
      [{ name: "http", port: services.agentRuntime?.port || 8081 }],
      [
        envValue("PORT", services.agentRuntime?.port || 8081),
        envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir),
      ],
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "orchestrator",
      "orchestrator",
      [{ name: "http", port: services.orchestrator?.port || 9000 }],
      [
        envValue("PORT", services.orchestrator?.port || 9000),
        envValue("STORAGE_URL", api.storageUrl),
        envValue("AGENT_RUNTIME_URL", api.agentRuntimeUrl),
        envValue("MCP_SERVER_URL", api.mcpServerUrl),
        envValue("DASHBOARD_URL", api.dashboardUrl),
        envValue("NATS_URL", api.natsUrl),
        envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir),
        envValue("ELASTICSEARCH_URL", observability.elasticsearchUrl || ""),
        envValue("ELASTIC_LOG_INDEX_PATTERN", observability.elasticLogIndexPattern || "akira-service-logs-*"),
        ...modelRouterEnv(llm),
      ],
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "mcpServerGeneric",
      "mcp-server-generic",
      [{ name: "http", port: services.mcpServerGeneric?.port || 8080 }],
      [
        envValue("PORT", services.mcpServerGeneric?.port || 8080),
        envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir),
      ],
    ),
  );

  if (enabled(services.nats)) {
    const natsPorts = [
      { name: "client", port: services.nats.clientPort || 4222 },
      { name: "monitor", port: services.nats.monitorPort || 8222 },
    ];
    documents.push(
      ...serviceDocs(
        config,
        "nats",
        "nats",
        natsPorts,
        [],
        { args: String(services.nats.args || "-js").split(/\s+/).filter(Boolean) },
      ),
    );
  }

  documents.push(
    ...serviceDocs(
      config,
      "prometheus",
      "prometheus",
      [{ name: "http", port: services.prometheus?.port || 9090 }],
      [],
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "otelCollector",
      "otel-collector",
      [],
      [envValue("OBSERVABILITY_LOG_DIR", platform.observabilityLogDir)],
    ),
  );

  documents.push(
    ...serviceDocs(
      config,
      "elasticsearch",
      "elasticsearch",
      [{ name: "http", port: services.elasticsearch?.port || 9200 }],
      [
        envValue("discovery.type", "single-node"),
        envValue("xpack.security.enabled", "false"),
      ],
    ),
  );

  return documents;
}

export function renderKubernetesYaml(config) {
  return [
    "# Generated from config/akira.yaml by scripts/generate-k8s.mjs.",
    "# Edit the single AKIRA config, then run npm run k8s:generate.",
    buildKubernetesDocuments(config).map((document) => toYaml(document)).join("\n---\n"),
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    configPath: defaultConfigPath,
    outputPath: defaultOutputPath,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--config") {
      args.configPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (item === "--out") {
      args.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (item === "--stdout") {
      args.stdout = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await readFile(args.configPath, "utf-8");
  const config = parseSimpleYaml(source);
  const yaml = renderKubernetesYaml(config);
  if (args.stdout) {
    process.stdout.write(yaml);
    return;
  }
  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, yaml);
  console.log(`Generated ${path.relative(repoRoot, args.outputPath)} from ${path.relative(repoRoot, args.configPath)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
