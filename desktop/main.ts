import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let apiBaseUrl = "";
let desktopSessionToken = "";

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local API port."));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function persistentSecret(configDir: string): string {
  const path = join(configDir, "jwt-secret");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const value = randomBytes(48).toString("base64url");
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
  return value;
}

function sqliteUrl(path: string): string {
  return `sqlite:///${path}`;
}

function backendCommand(): { executable: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    return {
      executable: join(process.resourcesPath, "backend", "inkmind-backend"),
      args: [],
      cwd: join(process.resourcesPath, "backend")
    };
  }

  const projectRoot = resolve(__dirname, "../..");
  const backendDir = join(projectRoot, "backend");
  const configuredPython = process.env.INKMIND_PYTHON;
  const desktopPython = join(backendDir, ".venv-desktop", "bin", "python");
  const regularPython = join(backendDir, ".venv", "bin", "python");
  const executable = configuredPython
    || (existsSync(desktopPython) ? desktopPython : "")
    || (existsSync(regularPython) ? regularPython : "")
    || "python3.12";
  return { executable, args: ["desktop_entry.py"], cwd: backendDir };
}

async function waitForBackend(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local API exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 180));
  }
  throw new Error(`Local API did not become ready: ${lastError}`);
}

async function startBackend(): Promise<void> {
  const userData = app.getPath("userData");
  const dataDir = join(userData, "data");
  const configDir = join(userData, "config");
  const logDir = join(userData, "logs");
  for (const directory of [dataDir, configDir, logDir]) mkdirSync(directory, { recursive: true });

  const port = await findFreePort();
  apiBaseUrl = `http://127.0.0.1:${port}`;
  desktopSessionToken = randomBytes(32).toString("base64url");
  const command = backendCommand();
  const frontendDir = app.isPackaged ? join(process.resourcesPath, "frontend") : "";
  const args = [...command.args, "--host", "127.0.0.1", "--port", String(port)];
  const logPath = join(logDir, "backend.log");

  backendProcess = spawn(command.executable, args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      DATABASE_URL: sqliteUrl(join(dataDir, "inkmind.db")),
      SECRET_KEY: persistentSecret(configDir),
      INKMIND_DESKTOP: "true",
      DESKTOP_MODE: "true",
      DESKTOP_SESSION_TOKEN: desktopSessionToken,
      DESKTOP_FRONTEND_DIR: frontendDir,
      OTEL_ENABLED: "false",
      PROMETHEUS_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  backendProcess.stdout?.on("data", (chunk) => appendFileSync(logPath, chunk));
  backendProcess.stderr?.on("data", (chunk) => appendFileSync(logPath, chunk));
  await waitForBackend(backendProcess);
}

function stopBackend(): void {
  const child = backendProcess;
  backendProcess = null;
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#faf9f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      additionalArguments: [`--inkmind-api=${apiBaseUrl}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererUrl = process.env.INKMIND_FRONTEND_DEV_URL || apiBaseUrl;
  void window.loadURL(rendererUrl);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const allowedOrigins = [new URL(rendererUrl).origin, new URL(apiBaseUrl).origin];
    if (!allowedOrigins.includes(new URL(url).origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  window.on("closed", () => { mainWindow = null; });
  return window;
}

ipcMain.handle("desktop:get-session", async () => {
  const response = await fetch(`${apiBaseUrl}/auth/desktop-session`, {
    method: "POST",
    headers: { "X-InkMind-Desktop-Token": desktopSessionToken }
  });
  if (!response.ok) throw new Error(`Could not open the local writing library (${response.status}).`);
  return response.json();
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) mainWindow = createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      mainWindow = createWindow();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("InkMind could not start", `${detail}\n\nSee the backend log in ${join(app.getPath("userData"), "logs")}.`);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow && apiBaseUrl) mainWindow = createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", stopBackend);
}
