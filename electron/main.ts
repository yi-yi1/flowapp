import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import type {
  WorkflowRunHistoryItem,
  WorkflowPendingReview,
  WorkflowReviewActionRequest,
  WorkflowReviewDraftUpdateRequest,
  WorkflowRunRequest,
  WorkflowRunResult,
} from "../shared/runtime";
import type { WorkflowEditorDraft } from "../shared/editor-state";
import type { WorkflowModelSettings } from "../shared/model-settings";
import {
  createWorkflowDocument,
  parseWorkflowDocument,
} from "../shared/workflow-document";
import {
  executeWorkflow,
  initializeWorkflowEngine,
  listPendingReviews,
  updateReviewDraft,
  submitReviewDecision,
} from "./services/workflow-engine-v2";
import {
  getModelServiceSettings,
  hydrateModelServiceSettings,
  testModelServiceConnection,
} from "./services/model-service";
import {
  initializeModelSettingsStore,
  loadModelSettings,
  saveModelSettings,
} from "./services/model-settings-store";
import {
  clearWorkflowDraft,
  initializeWorkflowDraftStore,
  loadWorkflowDraft,
  saveWorkflowDraft,
} from "./services/workflow-draft-store";
import {
  appendWorkflowHistory,
  clearWorkflowHistory,
  initializeWorkflowHistoryStore,
  listWorkflowHistory,
} from "./services/workflow-history-store-v2";

if (started) {
  app.quit();
}

type AppInfo = {
  appName: string;
  versions: NodeJS.ProcessVersions;
  platform: NodeJS.Platform;
};

let mainWindow: BrowserWindow | null = null;

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1417",
    webPreferences: {
      preload: path.join(__dirname, "../build-preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const registerIpcHandlers = (): void => {
  ipcMain.handle("app:ping", async () => "pong");

  ipcMain.handle("app:get-info", async (): Promise<AppInfo> => {
    return {
      appName: app.getName(),
      versions: process.versions,
      platform: process.platform,
    };
  });

  ipcMain.handle("dialog:open-directory", async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择工作流工作区",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle(
    "workflow:run",
    async (_event, payload: WorkflowRunRequest): Promise<WorkflowRunResult> => {
      const result = await executeWorkflow(payload);
      await appendWorkflowHistory(result, {
        source: "run",
        workspacePath: payload.workspacePath,
      });
      return result;
    },
  );

  ipcMain.handle(
    "workflow:list-pending-reviews",
    async (): Promise<WorkflowPendingReview[]> => listPendingReviews(),
  );

  ipcMain.handle(
    "workflow:update-review-draft",
    async (
      _event,
      payload: WorkflowReviewDraftUpdateRequest,
    ): Promise<WorkflowPendingReview[]> => updateReviewDraft(payload),
  );

  ipcMain.handle(
    "workflow:submit-review-decision",
    async (
      _event,
      payload: WorkflowReviewActionRequest,
    ): Promise<WorkflowRunResult> => {
      const result = await submitReviewDecision(payload);
      await appendWorkflowHistory(result, {
        source: "review",
        workspacePath: result.pendingReview?.workspacePath ?? result.variablesSnapshot.workspace_path ?? null,
      });
      return result;
    },
  );

  ipcMain.handle(
    "workflow:list-history",
    async (): Promise<WorkflowRunHistoryItem[]> => listWorkflowHistory(),
  );

  ipcMain.handle("workflow:clear-history", async (): Promise<void> => {
    await clearWorkflowHistory();
  });

  ipcMain.handle(
    "workflow:export-history",
    async (
      _event,
      payload: {
        item: WorkflowRunHistoryItem;
        format: "markdown" | "json";
      },
    ): Promise<string | null> => {
      if (!mainWindow) {
        return null;
      }

      const extension = payload.format === "markdown" ? "md" : "json";
      const result = await dialog.showSaveDialog(mainWindow, {
        title: payload.format === "markdown" ? "导出运行报告" : "导出运行记录 JSON",
        defaultPath: `workflow-history-${payload.item.id}.${extension}`,
        filters: [
          {
            name: payload.format === "markdown" ? "Markdown 文件" : "JSON 文件",
            extensions: [extension],
          },
        ],
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      if (payload.format === "json") {
        await fs.writeFile(result.filePath, JSON.stringify(payload.item, null, 2), "utf8");
        return result.filePath;
      }

      const markdown = [
        "# 工作流运行报告",
        "",
        `- 记录 ID：${payload.item.id}`,
        `- 来源：${payload.item.source === "run" ? "直接运行" : "审核处理"}`,
        `- 状态：${payload.item.status}`,
        `- 开始时间：${payload.item.startedAt}`,
        `- 结束时间：${payload.item.finishedAt}`,
        `- 工作区：${payload.item.workspacePath ?? "未选择"}`,
        `- 步骤数：${payload.item.stepCount}`,
        "",
        "## 摘要",
        "",
        payload.item.summary,
        "",
        "## 变量快照",
        "",
        "```json",
        JSON.stringify(payload.item.variablesSnapshot, null, 2),
        "```",
        "",
        "## 执行路径",
        "",
        ...payload.item.pathTrace.flatMap((entry, index) => [
          `### ${index + 1}. ${entry.title}`,
          "",
          `- 节点 ID：${entry.nodeId}`,
          `- 节点类型：${entry.nodeKind}`,
          `- 摘要：${entry.summary}`,
          `- 命中分支：${entry.chosenExit?.branchKey ?? "默认出口"}`,
          `- 下一节点：${entry.chosenExit?.target ?? "流程结束或等待人工处理"}`,
          "",
        ]),
        "## 步骤详情",
        "",
        ...payload.item.steps.flatMap((step, index) => [
          `### ${index + 1}. ${step.title}`,
          "",
          `- 节点 ID：${step.nodeId}`,
          `- 节点类型：${step.kind}`,
          `- 摘要：${step.summary}`,
          ...(step.output ? ["", "```text", step.output, "```"] : []),
          "",
        ]),
      ].join("\n");

      await fs.writeFile(result.filePath, markdown, "utf8");
      return result.filePath;
    },
  );

  ipcMain.handle(
    "workflow:load-draft",
    async (): Promise<WorkflowEditorDraft | null> => loadWorkflowDraft(),
  );

  ipcMain.handle(
    "workflow:save-draft",
    async (_event, payload: WorkflowEditorDraft): Promise<WorkflowEditorDraft> =>
      saveWorkflowDraft(payload),
  );

  ipcMain.handle("workflow:clear-draft", async (): Promise<void> => {
    await clearWorkflowDraft();
  });

  ipcMain.handle(
    "workflow:export-json",
    async (
      _event,
      payload: {
        name: string;
        draft: WorkflowEditorDraft;
        kind?: "workflow" | "template";
      },
    ) => {
      if (!mainWindow) {
        return null;
      }

      const result = await dialog.showSaveDialog(mainWindow, {
        title: payload.kind === "template" ? "导出流程模板 JSON" : "导出工作流 JSON",
        defaultPath: `${payload.name || "workflow"}.json`,
        filters: [
          {
            name: "工作流文件",
            extensions: ["json"],
          },
        ],
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      const document = createWorkflowDocument(
        payload.name || "workflow",
        payload.draft,
        payload.kind ?? "workflow",
      );
      await fs.writeFile(result.filePath, JSON.stringify(document, null, 2), "utf8");

      return result.filePath;
    },
  );

  ipcMain.handle("workflow:import-json", async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入工作流 JSON",
      properties: ["openFile"],
      filters: [
        {
          name: "工作流文件",
          extensions: ["json"],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseWorkflowDocument(JSON.parse(content));

    return {
      filePath,
      draft: parsed.draft,
      documentKind: parsed.kind,
      name: parsed.name,
    };
  });

  ipcMain.handle(
    "model-service:get-settings",
    async (): Promise<WorkflowModelSettings> => getModelServiceSettings(),
  );

  ipcMain.handle(
    "model-service:save-settings",
    async (
      _event,
      payload: WorkflowModelSettings,
    ): Promise<WorkflowModelSettings> => {
      const next = hydrateModelServiceSettings(payload);
      await saveModelSettings(next);
      return next;
    },
  );

  ipcMain.handle(
    "model-service:test-connection",
    async (
      _event,
      payload?: Partial<WorkflowModelSettings>,
    ): Promise<{ ok: true; model: string; preview: string }> =>
      testModelServiceConnection(payload),
  );
};

app.whenReady().then(async () => {
  await initializeWorkflowEngine(app.getPath("userData"));
  await initializeWorkflowDraftStore(app.getPath("userData"));
  await initializeModelSettingsStore(app.getPath("userData"));
  await initializeWorkflowHistoryStore(app.getPath("userData"));
  hydrateModelServiceSettings(await loadModelSettings());
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
