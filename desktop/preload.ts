import { contextBridge, ipcRenderer } from "electron";

const apiArgument = process.argv.find((value) => value.startsWith("--inkmind-api="));
const apiBaseUrl = apiArgument?.slice("--inkmind-api=".length) || "";

contextBridge.exposeInMainWorld("inkMindDesktop", {
  isDesktop: true,
  apiBaseUrl,
  platform: process.platform,
  getSession: () => ipcRenderer.invoke("desktop:get-session")
});
