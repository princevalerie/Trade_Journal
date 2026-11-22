import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStandaloneServer, type ServerInstance } from "./server-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let serverInstance: ServerInstance | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("⚠️ Another instance of Trade Journal is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const createWindow = (port: number) => {
    mainWindow = new BrowserWindow({
      title: "Trade Journal",
      width: 1440,
      height: 900,
      minWidth: 1080,
      minHeight: 720,
      backgroundColor: "#090d16",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    mainWindow.removeMenu();

    const targetUrl = `http://127.0.0.1:${port}`;
    mainWindow.loadURL(targetUrl);

    mainWindow.once("ready-to-show", () => {
      mainWindow?.show();
    });

    // Open target="_blank" and external links in user's default web browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        if (!url.includes(`127.0.0.1:${port}`) && !url.includes(`localhost:${port}`)) {
          shell.openExternal(url);
          return { action: "deny" };
        }
      }
      return { action: "allow" };
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  };

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    ipcMain.handle("get-app-version", () => app.getVersion());
    ipcMain.handle("get-data-dir", () => serverInstance?.dataDir ?? "");

    try {
      serverInstance = await startStandaloneServer();
      createWindow(serverInstance.port);
    } catch (err) {
      console.error("Failed to start Trade Journal server:", err);
      dialog.showErrorBox(
        "Failed to Start Trade Journal",
        err instanceof Error ? err.message : String(err)
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverInstance) {
        createWindow(serverInstance.port);
      }
    });
  });

  app.on("before-quit", () => {
    if (serverInstance) {
      serverInstance.stop();
      serverInstance = null;
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
