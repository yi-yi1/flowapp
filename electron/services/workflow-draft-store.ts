import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowEditorDraft } from "../../shared/editor-state";

let draftFilePath: string | null = null;

const ensureInitialized = (): string => {
  if (!draftFilePath) {
    throw new Error("工作流草稿存储尚未初始化。");
  }

  return draftFilePath;
};

export const initializeWorkflowDraftStore = async (
  userDataPath: string,
): Promise<void> => {
  draftFilePath = path.join(userDataPath, "workflow-editor-draft.json");
  await fs.mkdir(path.dirname(draftFilePath), { recursive: true });
};

export const loadWorkflowDraft = async (): Promise<WorkflowEditorDraft | null> => {
  const target = ensureInitialized();

  try {
    const content = await fs.readFile(target, "utf8");
    return JSON.parse(content) as WorkflowEditorDraft;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

export const saveWorkflowDraft = async (
  draft: WorkflowEditorDraft,
): Promise<WorkflowEditorDraft> => {
  const target = ensureInitialized();
  await fs.writeFile(target, JSON.stringify(draft, null, 2), "utf8");
  return draft;
};

export const clearWorkflowDraft = async (): Promise<void> => {
  const target = ensureInitialized();

  try {
    await fs.unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};
