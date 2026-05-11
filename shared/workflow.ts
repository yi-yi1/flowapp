export type NodeKind =
  | "start"
  | "llm"
  | "condition"
  | "tool"
  | "review"
  | "loop"
  | "end";

export type NodePosition = {
  x: number;
  y: number;
};

export type StartNodeConfig = {
  inputTemplate: string;
};

export type LlmNodeOutputMode = "text" | "structured";

export type LlmNodeConfig = {
  model: string;
  systemPrompt: string;
  promptTemplate: string;
  outputMode: LlmNodeOutputMode;
  outputSchema: string;
};

export type ConditionNodeConfig = {
  expression: string;
  trueLabel: string;
  falseLabel: string;
};

export type ToolFailureStrategy = "fail" | "empty";

export type WorkspaceFileToolConfig = {
  toolType: "workspace_file";
  relativePath: string;
  encoding: "utf8" | "base64";
  failureStrategy: ToolFailureStrategy;
};

export type HttpRequestToolConfig = {
  toolType: "http_request";
  method: "GET" | "POST";
  url: string;
  headersText: string;
  bodyTemplate: string;
  failureStrategy: ToolFailureStrategy;
};

export type ToolNodeConfig = WorkspaceFileToolConfig | HttpRequestToolConfig;

export type ReviewNodeConfig = {
  instructions: string;
};

export type LoopNodeConfig = {
  itemsVariable: string;
  itemVariableName: string;
  itemBranchKey: string;
  doneBranchKey: string;
};

export type EndNodeConfig = {
  outputFormat: "markdown" | "plain-text";
};

export type NodeConfig =
  | StartNodeConfig
  | LlmNodeConfig
  | ConditionNodeConfig
  | ToolNodeConfig
  | ReviewNodeConfig
  | LoopNodeConfig
  | EndNodeConfig;

export type FlowNode = {
  id: string;
  kind: NodeKind;
  label: string;
  description: string;
  position: NodePosition;
  config: NodeConfig;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  branchKey?: string;
};

const kindLabelMap: Record<NodeKind, string> = {
  start: "开始",
  llm: "模型",
  condition: "条件",
  tool: "工具",
  review: "审核",
  loop: "循环",
  end: "结束",
};

const kindDescriptionMap: Record<NodeKind, string> = {
  start: "收集用户输入，并初始化工作流的上下文状态。",
  llm: "调用模型节点，把生成结果写回工作流状态。",
  condition: "根据变量与表达式选择下一条分支。",
  tool: "执行确定性工具，把结果写入上下文变量。",
  review: "等待人工审核后，再继续执行后续步骤。",
  loop: "从列表变量中逐项取值，串行驱动后续节点执行。",
  end: "整理最终输出，并交给桌面端界面展示。",
};

const defaultNodeConfigMap: Record<NodeKind, NodeConfig> = {
  start: {
    inputTemplate: "分析当前任务，并给出下一步最值得推进的实现计划。",
  },
  llm: {
    model: "qwen3.5-9b",
    systemPrompt: "你是工作流规划助手，请为下一个节点生成清晰、可执行的输出。",
    promptTemplate:
      "请基于当前上下文继续完成当前节点。上一节点输出：{{last_output}}",
    outputMode: "text",
    outputSchema:
      '{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" }\n  },\n  "required": ["summary"]\n}',
  },
  condition: {
    expression: "{{last_output}} contains 通过",
    trueLabel: "满足",
    falseLabel: "不满足",
  },
  tool: {
    toolType: "workspace_file",
    relativePath: "README.md",
    encoding: "utf8",
    failureStrategy: "empty",
  },
  review: {
    instructions: "在继续执行前，请人工确认草稿内容是否符合预期。",
  },
  loop: {
    itemsVariable: "{{last_output}}",
    itemVariableName: "loop_item",
    itemBranchKey: "item",
    doneBranchKey: "done",
  },
  end: {
    outputFormat: "markdown",
  },
};

export const createNode = (kind: NodeKind, index: number): FlowNode => {
  const id = `${kind}-${index + 1}`;

  return {
    id,
    kind,
    label: `${kindLabelMap[kind]}节点`,
    description: kindDescriptionMap[kind],
    position: {
      x: 120 + index * 180,
      y: 120 + index * 64,
    },
    config: defaultNodeConfigMap[kind],
  };
};

export const isStartNodeConfig = (config: NodeConfig): config is StartNodeConfig =>
  "inputTemplate" in config;

export const isLlmNodeConfig = (config: NodeConfig): config is LlmNodeConfig =>
  "systemPrompt" in config && "promptTemplate" in config;

export const isConditionNodeConfig = (
  config: NodeConfig,
): config is ConditionNodeConfig => "expression" in config;

export const isToolNodeConfig = (config: NodeConfig): config is ToolNodeConfig =>
  "toolType" in config;

export const isReviewNodeConfig = (
  config: NodeConfig,
): config is ReviewNodeConfig => "instructions" in config;

export const isLoopNodeConfig = (config: NodeConfig): config is LoopNodeConfig =>
  "itemsVariable" in config && "itemVariableName" in config;

export const isEndNodeConfig = (config: NodeConfig): config is EndNodeConfig =>
  "outputFormat" in config;

export const initialNodes: FlowNode[] = [
  {
    id: "start-1",
    kind: "start",
    label: "采集目标",
    description: "根据用户任务和工作区信息初始化本次工作流。",
    position: { x: 120, y: 120 },
    config: {
      inputTemplate: "分析当前项目，并说明下一个最值得推进的实现里程碑。",
    },
  },
  {
    id: "tool-1",
    kind: "tool",
    label: "读取工作区说明",
    description: "读取工作区中的说明文件，并写入上下文。",
    position: { x: 360, y: 160 },
    config: {
      toolType: "workspace_file",
      relativePath: "README.md",
      encoding: "utf8",
      failureStrategy: "empty",
    },
  },
  {
    id: "llm-1",
    kind: "llm",
    label: "规划节点",
    description: "根据输入生成下一步行动计划，并写回状态。",
    position: { x: 620, y: 220 },
    config: {
      model: "qwen3.5-9b",
      systemPrompt: "请把用户意图整理成按顺序执行的实现计划，并补充验证建议。",
      promptTemplate:
        "请结合开始节点和工具节点提供的上下文，生成下一步实施建议。上一节点输出：{{last_output}}",
      outputMode: "text",
      outputSchema:
        '{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" },\n    "risk": { "type": "string" }\n  },\n  "required": ["summary"]\n}',
    },
  },
  {
    id: "condition-1",
    kind: "condition",
    label: "是否需要人工审核",
    description: "根据模型输出结果，决定是直接结束还是进入审核。",
    position: { x: 880, y: 220 },
    config: {
      expression: "{{last_output}} contains 风险",
      trueLabel: "需要审核",
      falseLabel: "直接结束",
    },
  },
  {
    id: "review-1",
    kind: "review",
    label: "人工审核",
    description: "暂停流程，等待操作者确认后继续。",
    position: { x: 1140, y: 120 },
    config: {
      instructions: "确认计划内容，必要时补充风险说明，然后继续执行。",
    },
  },
  {
    id: "end-1",
    kind: "end",
    label: "结果输出",
    description: "整理最终答案，以适合桌面端展示的格式返回。",
    position: { x: 1140, y: 340 },
    config: {
      outputFormat: "markdown",
    },
  },
];

export const initialEdges: FlowEdge[] = [
  {
    id: "edge-start-tool",
    source: "start-1",
    target: "tool-1",
    label: "初始化上下文",
  },
  {
    id: "edge-tool-planner",
    source: "tool-1",
    target: "llm-1",
    label: "文件内容",
  },
  {
    id: "edge-planner-condition",
    source: "llm-1",
    target: "condition-1",
    label: "生成草稿",
  },
  {
    id: "edge-condition-review",
    source: "condition-1",
    target: "review-1",
    label: "需要审核",
    branchKey: "true",
  },
  {
    id: "edge-condition-end",
    source: "condition-1",
    target: "end-1",
    label: "直接结束",
    branchKey: "false",
  },
  {
    id: "edge-review-end",
    source: "review-1",
    target: "end-1",
    label: "审核通过",
    branchKey: "approved",
  },
];
