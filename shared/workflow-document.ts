import type { WorkflowEditorDraft } from "./editor-state";

export type WorkflowDocumentKind = "workflow" | "template";

export type WorkflowDocument = {
  version: 1;
  name: string;
  exportedAt: string;
  kind: WorkflowDocumentKind;
  draft: WorkflowEditorDraft;
};

export const createWorkflowDocument = (
  name: string,
  draft: WorkflowEditorDraft,
  kind: WorkflowDocumentKind = "workflow",
): WorkflowDocument => ({
  version: 1,
  name,
  exportedAt: new Date().toISOString(),
  kind,
  draft,
});

export const isWorkflowEditorDraft = (
  value: unknown,
): value is WorkflowEditorDraft => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkflowEditorDraft>;
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    (candidate.selectedNodeId === null ||
      typeof candidate.selectedNodeId === "string" ||
      candidate.selectedNodeId === undefined) &&
    (candidate.workspacePath === null ||
      typeof candidate.workspacePath === "string" ||
      candidate.workspacePath === undefined) &&
    (candidate.theme === "dark" || candidate.theme === "light")
  );
};

const isWorkflowDocument = (value: unknown): value is WorkflowDocument => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkflowDocument>;
  return (
    candidate.version === 1 &&
    typeof candidate.name === "string" &&
    typeof candidate.exportedAt === "string" &&
    (candidate.kind === "workflow" || candidate.kind === "template") &&
    isWorkflowEditorDraft(candidate.draft)
  );
};

export const parseWorkflowDocument = (
  value: unknown,
): WorkflowDocument => {
  if (isWorkflowEditorDraft(value)) {
    return createWorkflowDocument("导入的工作流", value);
  }

  if (isWorkflowDocument(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "draft" in value &&
    isWorkflowEditorDraft((value as { draft?: unknown }).draft)
  ) {
    const candidate = value as {
      name?: unknown;
      exportedAt?: unknown;
      draft: WorkflowEditorDraft;
      kind?: unknown;
    };

    return {
      version: 1,
      name:
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name
          : "导入的工作流",
      exportedAt:
        typeof candidate.exportedAt === "string"
          ? candidate.exportedAt
          : new Date().toISOString(),
      kind: candidate.kind === "template" ? "template" : "workflow",
      draft: candidate.draft,
    };
  }

  throw new Error("导入文件不是有效的工作流 JSON。");
};

