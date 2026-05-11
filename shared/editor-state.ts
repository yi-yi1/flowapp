import type { FlowEdge, FlowNode } from "./workflow";

export type WorkflowEditorDraft = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  workspacePath: string | null;
  theme: "dark" | "light";
};
