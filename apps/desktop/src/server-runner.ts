import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerInstance {
  port: number;
  dataDir: string;
  process: ChildProcess;
  stop: () => void;
}

const isPortInUse = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = http
      .createServer()
      .once("error", () => resolve(true))
      .once("listening", () => {
        server.close();
        resolve(false);
      })
      .listen(port, "127.0.0.1");
  });
};

const findAvailablePort = async (preferredPort: number = 3000): Promise<number> => {
  const inUse = await isPortInUse(preferredPort);
  if (!inUse) return preferredPort;

  // If 3000 is taken, try subsequent ports
  for (let port = preferredPort + 1; port < preferredPort + 50; port++) {
    const used = await isPortInUse(port);
    if (!used) return port;
  }
  return preferredPort;
};

const getStandalonePath = (): string => {
  if (app.isPackaged) {
    // In packaged app, extraResources copies to resources/standalone
    const packaged1 = path.join(process.resourcesPath, "standalone", "apps", "web", "server.js");
    if (fs.existsSync(packaged1)) return packaged1;
    const packaged2 = path.join(process.resourcesPath, "standalone", "server.js");
    if (fs.existsSync(packaged2)) return packaged2;
  }

  // Development / unpacked mode
  const dev1 = path.resolve(__dirname, "../../standalone/apps/web/server.js");
  if (fs.existsSync(dev1)) return dev1;
  const dev2 = path.resolve(__dirname, "../../standalone/server.js");
  if (fs.existsSync(dev2)) return dev2;
  const dev3 = path.resolve(__dirname, "../../../web/.next/standalone/apps/web/server.js");
  if (fs.existsSync(dev3)) return dev3;

  throw new Error("Could not find Next.js standalone server.js. Please build the web project first.");
};

const waitForServerReady = (url: string, timeoutMs: number = 45000): Promise<void> => {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`));
        return;
      }

      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          clearInterval(interval);
          resolve();
        }
      });

      req.on("error", () => {
        // Still starting up, wait for next tick
      });

      req.end();
    }, 250);
  });
};

export const startStandaloneServer = async (): Promise<ServerInstance> => {
  const serverJs = getStandalonePath();
  const serverDir = path.dirname(serverJs);
  const targetPort = await findAvailablePort(3000);

  // Use standard OS user data folder for persistence:
  // Windows: %APPDATA%\TradeJournal\data
  // macOS: ~/Library/Application Support/TradeJournal/data
  const journalDataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(journalDataDir, { recursive: true });

  console.log(`🚀 [Desktop Server] Starting Next.js standalone server...`);
  console.log(`📁 Server Script: ${serverJs}`);
  console.log(`📂 Data Directory: ${journalDataDir}`);
  console.log(`🌐 Port: ${targetPort}`);

  const child = spawn(process.execPath, [serverJs], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(targetPort),
      HOSTNAME: "127.0.0.1",
      JOURNAL_DATA_DIR: journalDataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[Next.js stdout] ${chunk.toString().trim()}`);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[Next.js stderr] ${chunk.toString().trim()}`);
  });

  child.on("exit", (code, signal) => {
    console.log(`[Next.js exited] code: ${code}, signal: ${signal}`);
  });

  const healthUrl = `http://127.0.0.1:${targetPort}/`;
  await waitForServerReady(healthUrl);
  console.log(`✅ [Desktop Server] Next.js server ready at ${healthUrl}`);

  // Automatically start MT4 WebRequest Proxy on Port 80 -> targetPort
  let proxyServer: http.Server | null = null;
  try {
    proxyServer = http.createServer((req, res) => {
      const options = {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${targetPort}`,
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on("error", (err) => {
        console.error("⚠️ [Desktop MT4 Proxy Error]", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy forwarding failed", message: err.message }));
      });

      req.pipe(proxyReq, { end: true });
    });

    proxyServer.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.log("ℹ️ [Desktop MT4 Proxy] Port 80 already in use, skipping internal proxy.");
      } else {
        console.warn("⚠️ [Desktop MT4 Proxy] Could not bind to port 80:", err.message);
      }
    });

    proxyServer.listen(80, "127.0.0.1", () => {
      console.log(`🚀 [Desktop MT4 Proxy] MT4 Proxy automatically listening on http://127.0.0.1:80 -> port ${targetPort}`);
    });
  } catch (err: any) {
    console.warn("⚠️ [Desktop MT4 Proxy] Failed to initialize proxy:", err.message);
  }

  const stop = () => {
    if (proxyServer) {
      try {
        proxyServer.close();
      } catch {}
      proxyServer = null;
    }
    if (!child.killed) {
      console.log("🛑 [Desktop Server] Terminating Next.js server process...");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000);
    }
  };

  return {
    port: targetPort,
    dataDir: journalDataDir,
    process: child,
    stop,
  };
};
