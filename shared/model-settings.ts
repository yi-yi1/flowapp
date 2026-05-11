export type WorkflowModelSettings = {
  serviceUrl: string;
  defaultModel: string;
  requestTimeoutMs: number;
};

export const defaultWorkflowModelSettings: WorkflowModelSettings = {
  serviceUrl: "http://10.16.7.142:11434/v1/chat/completions",
  defaultModel: "qwen3.5-9b",
  requestTimeoutMs: 45000,
};
