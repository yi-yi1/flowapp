/// <reference types="vite/client" />
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

declare module "*.css" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    electronAPI: {
      ping: () => Promise<string>;
      getAppInfo: () => Promise<{
        appName: string;
        versions: NodeJS.ProcessVersions;
        platform: NodeJS.Platform;
      }>;
      openDirectory: () => Promise<string | null>;
      runWorkflow: (payload: WorkflowRunRequest) => Promise<WorkflowRunResult>;
      listPendingReviews: () => Promise<WorkflowPendingReview[]>;
      listWorkflowHistory: () => Promise<WorkflowRunHistoryItem[]>;
      clearWorkflowHistory: () => Promise<void>;
      exportWorkflowHistory: (payload: {
        item: WorkflowRunHistoryItem;
        format: "markdown" | "json";
      }) => Promise<string | null>;
      updateReviewDraft: (
        payload: WorkflowReviewDraftUpdateRequest,
      ) => Promise<WorkflowPendingReview[]>;
      submitReviewDecision: (
        payload: WorkflowReviewActionRequest,
      ) => Promise<WorkflowRunResult>;
      loadWorkflowDraft: () => Promise<WorkflowEditorDraft | null>;
      saveWorkflowDraft: (payload: WorkflowEditorDraft) => Promise<WorkflowEditorDraft>;
      clearWorkflowDraft: () => Promise<void>;
      exportWorkflowJson: (payload: {
        name: string;
        draft: WorkflowEditorDraft;
        kind?: WorkflowDocument["kind"];
      }) => Promise<string | null>;
      importWorkflowJson: () => Promise<
        | {
            filePath: string;
            draft: WorkflowDocument["draft"];
            documentKind: WorkflowDocument["kind"];
            name: WorkflowDocument["name"];
          }
        | null
      >;
      getModelSettings: () => Promise<WorkflowModelSettings>;
      saveModelSettings: (payload: WorkflowModelSettings) => Promise<WorkflowModelSettings>;
      testModelConnection: (payload?: Partial<WorkflowModelSettings>) => Promise<{
        ok: true;
        model: string;
        preview: string;
      }>;
    };
  }
}
