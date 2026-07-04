import { createStorageService } from "./app.mjs";
import { createNodeObservability } from "../../packages/observability/node.mjs";

const port = Number(process.env.PORT || 9100);
const service = createStorageService({
  dataDir: process.env.STORAGE_DATA_DIR
});
const observability = createNodeObservability({ serviceName: "storage-mcp-platform" });

await service.init();

const server = service.createServer();
server.listen(port, () => {
  void observability.log({
    logLevel: "INFO",
    className: "StorageServer",
    message: `storage-mcp-platform listening on http://localhost:${port}`,
    threadName: "storage.main",
    threadNumber: 0
  });
});
