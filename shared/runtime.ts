import type { NodeKind } from "./workflow";
import type { RuntimeNodeExit, WorkflowSpec } from "./compiler";

export type WorkflowRunRequest = {
  spec: WorkflowSpec;
  workspacePath: string | null;
};

export type WorkflowReviewDecision = "approved" | "rejected";

export type WorkflowVariables = Record<string, string>;

export type WorkflowPathTraceEntry = {
  nodeId: string;
  nodeKind: NodeKind;
  title: string;
  summary: string;
  chosenExit?: RuntimeNodeExit | null;
};

export type WorkflowPendingReview = {
  sessionId: string;
  reviewNodeId: string;
  title: string;
  instructions: string;
  latestOutput: string;
  reviewNoteDraft?: string;
  createdAt: string;
  workspacePath: string | null;
  steps: WorkflowRunStep[];
  variablesSnapshot: WorkflowVariables;
  pathTrace: WorkflowPathTraceEntry[];
};

export type WorkflowRunStatus = "completed" | "failed" | "paused";

export type WorkflowRunStep = {
  nodeId: string;
  kind: NodeKind;
  title: string;
  summary: string;
  output?: string;
};

export type WorkflowRunResult = {
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  summary: string;
  steps: WorkflowRunStep[];
  variablesSnapshot: WorkflowVariables;
  pathTrace: WorkflowPathTraceEntry[];
  sessionId?: string;
  pendingReview?: WorkflowPendingReview;
};

export type WorkflowRunHistoryItem = {
  id: string;
  source: "run" | "review";
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  summary: string;
  sessionId?: string;
  workspacePath: string | null;
  stepCount: number;
  steps: WorkflowRunStep[];
  variablesSnapshot: WorkflowVariables;
  pathTrace: WorkflowPathTraceEntry[];
};

export type WorkflowReviewActionRequest = {
  sessionId: string;
  decision: WorkflowReviewDecision;
  reviewNote?: string;
};

export type WorkflowReviewDraftUpdateRequest = {
  sessionId: string;
  reviewNoteDraft: string;
};
