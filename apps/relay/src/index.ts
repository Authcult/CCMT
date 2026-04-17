import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerAuthRoutes } from "./http/auth";
import { registerSessionRoutes } from "./http/sessions";
import { registerTargetRoutes } from "./http/targets";
import { registerAgentRoutes } from "./http/agents";
import { AuthService } from "./auth/service";
import { MemoryStore } from "./store/memory";
import { setupGateway } from "./ws/gateway";
import { FileStateRepository } from "./persistence/file-state";

const relayPort = Number(process.env.CCMT_RELAY_PORT ?? 8787);
const wsPath = process.env.CCMT_WS_PATH ?? "/ws";
const tokenSecret = process.env.CCMT_TOKEN_SECRET ?? "ccmt-dev-secret";
const agentEnrollSecret = process.env.CCMT_AGENT_ENROLL_SECRET ?? "ccmt-agent-enroll-dev";
const relayStateFile = process.env.CCMT_RELAY_STATE_FILE ?? "./.ccmt/relay-state.json";
const relayStateDebounceMs = Number(process.env.CCMT_RELAY_STATE_DEBOUNCE_MS ?? 500);

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["content-type", "authorization"],
});

const store = new MemoryStore();
const authService = new AuthService(tokenSecret);
const fileStateRepository = new FileStateRepository({
  filePath: relayStateFile,
  debounceMs: Number.isFinite(relayStateDebounceMs) && relayStateDebounceMs >= 0 ? relayStateDebounceMs : 500,
  logger: app.log,
  getState: () => ({
    version: 1,
    auth: authService.exportState(),
    store: store.exportState(),
  }),
});

const persistedState = await fileStateRepository.load();
if (persistedState) {
  authService.importState(persistedState.auth);
  store.importState(persistedState.store);
}

const scheduleSave = () => {
  fileStateRepository.scheduleSave();
};

authService.setOnDirty(scheduleSave);
store.setOnDirty(scheduleSave);

if (persistedState || authService.hasAnyUser() || store.listSessions().length > 0) {
  scheduleSave();
}

app.addHook("onClose", async () => {
  await fileStateRepository.flushNow();
});

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "shutting down relay");

  try {
    await app.close();
  } catch (error) {
    app.log.error({ error, signal }, "failed to close relay cleanly");
    process.exitCode = 1;
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

app.get("/health", async () => ({
  ok: true,
  now: Date.now(),
}));

registerAuthRoutes(app, { authService });
registerTargetRoutes(app, { authService, store });
registerSessionRoutes(app, { authService, store });
registerAgentRoutes(app, { authService, agentEnrollSecret });

setupGateway({
  server: app.server,
  wsPath,
  store,
  authService,
  logger: app.log,
});

app
  .listen({ port: relayPort, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ relayPort, wsPath, relayStateFile }, "CCMT relay started");
  })
  .catch((error) => {
    app.log.error({ error }, "failed to start relay");
    process.exit(1);
  });
