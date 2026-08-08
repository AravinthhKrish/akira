import { createStorageService } from "./app.mjs";
import { createNodeObservability } from "../../packages/observability/node.mjs";

const port = Number(process.env.PORT || 9100);
const service = createStorageService({
  backend: process.env.STORAGE_BACKEND,
  documentBackend: process.env.STORAGE_DOCUMENT_BACKEND,
  vectorBackend: process.env.STORAGE_VECTOR_BACKEND,
  dataDir: process.env.STORAGE_DATA_DIR,
  mongoUrl: process.env.MONGODB_URL || process.env.MONGO_URL,
  mongoDatabase: process.env.MONGODB_DATABASE,
  mongoCollectionPrefix: process.env.MONGODB_COLLECTION_PREFIX,
  weaviateUrl: process.env.WEAVIATE_URL,
  weaviateApiKey: process.env.WEAVIATE_API_KEY,
  weaviateClassName: process.env.WEAVIATE_CLASS_NAME,
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
