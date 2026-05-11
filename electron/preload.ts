import { contextBridge, ipcRenderer } from "electron";
import type { WorkflowEditorDraft } from "../shared/editor-state";
import type { WorkflowModelSettings } from "../shared/model-settings";
import type { WorkflowDocument } from "../shared/workflow-document";
import type {
  WorkflowRunHistoryItem,
  WorkflowPendingReview,
  WorkflowReviewActionRequest,
  WorkflowReviewDraftUpdateRequest,
  WorkflowRunRequest,
  WorkflowRunResult,
} from "../shared/runtime";

const electronAPI = {
  ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
  getAppInfo: () =>
    ipcRenderer.invoke("app:get-info") as Promise<{
      appName: string;
      versions: NodeJS.ProcessVersions;
      platform: NodeJS.Platform;
    }>,
  openDirectory: () =>
    ipcRenderer.invoke("dialog:open-directory") as Promise<string | null>,
  runWorkflow: (payload: WorkflowRunRequest) =>
    ipcRenderer.invoke("workflow:run", payload) as Promise<WorkflowRunResult>,
  listPendingReviews: () =>
    ipcRenderer.invoke("workflow:list-pending-reviews") as Promise<
      WorkflowPendingReview[]
    >,
  listWorkflowHistory: () =>
    ipcRenderer.invoke("workflow:list-history") as Promise<WorkflowRunHistoryItem[]>,
  clearWorkflowHistory: () =>
    ipcRenderer.invoke("workflow:clear-history") as Promise<void>,
  exportWorkflowHistory: (payload: {
    item: WorkflowRunHistoryItem;
    format: "markdown" | "json";
  }) =>
    ipcRenderer.invoke("workflow:export-history", payload) as Promise<string | null>,
  updateReviewDraft: (payload: WorkflowReviewDraftUpdateRequest) =>
    ipcRenderer.invoke("workflow:update-review-draft", payload) as Promise<WorkflowPendingReview[]>,
  submitReviewDecision: (payload: WorkflowReviewActionRequest) =>
    ipcRenderer.invoke("workflow:submit-review-decision", payload) as Promise<WorkflowRunResult>,
  loadWorkflowDraft: () =>
    ipcRenderer.invoke("workflow:load-draft") as Promise<WorkflowEditorDraft | null>,
  saveWorkflowDraft: (payload: WorkflowEditorDraft) =>
    ipcRenderer.invoke("workflow:save-draft", payload) as Promise<WorkflowEditorDraft>,
  clearWorkflowDraft: () =>
    ipcRenderer.invoke("workflow:clear-draft") as Promise<void>,
  exportWorkflowJson: (payload: {
    name: string;
    draft: WorkflowEditorDraft;
    kind?: WorkflowDocument["kind"];
  }) =>
    ipcRenderer.invoke("workflow:export-json", payload) as Promise<string | null>,
  importWorkflowJson: () =>
    ipcRenderer.invoke("workflow:import-json") as Promise<
      | {
          filePath: string;
          draft: WorkflowDocument["draft"];
          documentKind: WorkflowDocument["kind"];
          name: WorkflowDocument["name"];
        }
      | null
    >,
  getModelSettings: () =>
    ipcRenderer.invoke("model-service:get-settings") as Promise<WorkflowModelSettings>,
  saveModelSettings: (payload: WorkflowModelSettings) =>
    ipcRenderer.invoke("model-service:save-settings", payload) as Promise<WorkflowModelSettings>,
  testModelConnection: (payload?: Partial<WorkflowModelSettings>) =>
    ipcRenderer.invoke("model-service:test-connection", payload) as Promise<{
      ok: true;
      model: string;
      preview: string;
    }>,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
