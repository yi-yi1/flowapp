import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowRunHistoryItem, WorkflowRunResult } from "../../shared/runtime";

let historyFilePath: string | null = null;
let historyItems: WorkflowRunHistoryItem[] = [];

const ensureInitialized = (): string => {
  if (!historyFilePath) {
    throw new Error("运行历史存储尚未初始化。");
  }

  return historyFilePath;
};

const saveHistoryItems = async (): Promise<void> => {
  const target = ensureInitialized();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(historyItems, null, 2), "utf8");
};

export const initializeWorkflowHistoryStore = async (
  userDataPath: string,
): Promise<void> => {
  historyFilePath = path.join(userDataPath, "workflow-run-history.json");

  try {
    const content = await fs.readFile(historyFilePath, "utf8");
    historyItems = JSON.parse(content) as WorkflowRunHistoryItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      historyItems = [];
      await saveHistoryItems();
      return;
    }

    throw error;
  }
};

export const listWorkflowHistory = (): WorkflowRunHistoryItem[] => historyItems;

export const clearWorkflowHistory = async (): Promise<void> => {
  historyItems = [];
  await saveHistoryItems();
};

export const appendWorkflowHistory = async (
  result: WorkflowRunResult,
  options: {
    source: "run" | "review";
    workspacePath: string | null;
  },
): Promise<WorkflowRunHistoryItem[]> => {
  const item: WorkflowRunHistoryItem = {
    id: `${options.source}-${result.finishedAt}-${Math.random().toString(36).slice(2, 8)}`,
    source: options.source,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    summary: result.summary,
    sessionId: result.sessionId,
    workspacePath: options.workspacePath,
    stepCount: result.steps.length,
    steps: result.steps,
  };

  historyItems = [item, ...historyItems].slice(0, 40);
  await saveHistoryItems();
  return historyItems;
};
