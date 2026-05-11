import type { FlowEdge, FlowNode, NodeKind } from "./workflow";

export type RuntimeNodeSpec = {
  id: string;
  kind: NodeKind;
  label: string;
  next: RuntimeNodeExit[];
  config: FlowNode["config"];
};

export type RuntimeNodeExit = {
  edgeId: string;
  target: string;
  label?: string;
  branchKey?: string;
};

export type RuntimeEdgeSpec = {
  id: string;
  source: string;
  target: string;
  label?: string;
  branchKey?: string;
};

export type WorkflowSpec = {
  entryNodeId: string | null;
  nodes: RuntimeNodeSpec[];
  edges: RuntimeEdgeSpec[];
};

export const toWorkflowSpec = (
  nodes: FlowNode[],
  edges: FlowEdge[],
): WorkflowSpec => {
  const incoming = new Set(edges.map((edge) => edge.target));

  const entryNode =
    nodes.find((node) => node.kind === "start") ??
    nodes.find((node) => !incoming.has(node.id)) ??
    null;

  return {
    entryNodeId: entryNode?.id ?? null,
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      config: node.config,
      next: edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => ({
          edgeId: edge.id,
          target: edge.target,
          label: edge.label,
          branchKey: edge.branchKey,
        })),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      branchKey: edge.branchKey,
    })),
  };
};
