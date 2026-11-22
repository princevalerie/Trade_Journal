import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
});
