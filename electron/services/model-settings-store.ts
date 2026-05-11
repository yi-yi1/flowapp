import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowModelSettings } from "../../shared/model-settings";
import { defaultWorkflowModelSettings } from "../../shared/model-settings";

let settingsFilePath: string | null = null;

const ensureInitialized = (): string => {
  if (!settingsFilePath) {
    throw new Error("模型服务设置存储尚未初始化。");
  }

  return settingsFilePath;
};

export const initializeModelSettingsStore = async (
  userDataPath: string,
): Promise<void> => {
  settingsFilePath = path.join(userDataPath, "workflow-model-settings.json");
  await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
};

export const loadModelSettings = async (): Promise<WorkflowModelSettings> => {
  const target = ensureInitialized();

  try {
    const content = await fs.readFile(target, "utf8");
    return {
      ...defaultWorkflowModelSettings,
      ...(JSON.parse(content) as Partial<WorkflowModelSettings>),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultWorkflowModelSettings;
    }

    throw error;
  }
};

export const saveModelSettings = async (
  settings: WorkflowModelSettings,
): Promise<WorkflowModelSettings> => {
  const target = ensureInitialized();
  await fs.writeFile(target, JSON.stringify(settings, null, 2), "utf8");
  return settings;
};
