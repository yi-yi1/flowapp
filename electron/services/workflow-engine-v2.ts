import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeNodeExit, RuntimeNodeSpec, WorkflowSpec } from "../../shared/compiler";
import type {
  WorkflowPathTraceEntry,
  WorkflowPendingReview,
  WorkflowReviewActionRequest,
  WorkflowReviewDraftUpdateRequest,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowRunStep,
  WorkflowVariables,
} from "../../shared/runtime";
import {
  isConditionNodeConfig,
  isEndNodeConfig,
  isLlmNodeConfig,
  isLoopNodeConfig,
  isReviewNodeConfig,
  isStartNodeConfig,
  isToolNodeConfig,
} from "../../shared/workflow";
import {
  generateWithRemoteModel,
  getDefaultRemoteModel,
  getModelServiceUrl,
} from "./model-service";

type WorkflowExecutionState = {
  latestOutput: string;
  steps: WorkflowRunStep[];
  workspacePath: string | null;
  variables: WorkflowVariables;
  pathTrace: WorkflowPathTraceEntry[];
  loopState: Record<
    string,
    {
      items: string[];
      index: number;
      itemVariableName: string;
    }
  >;
};

type PendingWorkflowSession = {
  sessionId: string;
  spec: WorkflowSpec;
  workspacePath: string | null;
  currentNodeId: string;
  latestOutput: string;
  reviewNoteDraft?: string;
  steps: WorkflowRunStep[];
  startedAt: string;
  createdAt: string;
  variables: WorkflowVariables;
  pathTrace: WorkflowPathTraceEntry[];
  loopState: WorkflowExecutionState["loopState"];
};

const pendingSessions = new Map<string, PendingWorkflowSession>();
let persistenceFilePath: string | null = null;

const createSessionId = (): string =>
  `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getNodeById = (
  spec: WorkflowSpec,
  nodeId: string,
): RuntimeNodeSpec | undefined => spec.nodes.find((node) => node.id === nodeId);

const createInitialVariables = (workspacePath: string | null): WorkflowVariables => ({
  workspace_path: workspacePath ?? "",
  last_output: "",
  review_note: "",
});

const savePendingSessions = async (): Promise<void> => {
  if (!persistenceFilePath) {
    return;
  }

  await fs.mkdir(path.dirname(persistenceFilePath), { recursive: true });
  await fs.writeFile(
    persistenceFilePath,
    JSON.stringify(Array.from(pendingSessions.values()), null, 2),
    "utf8",
  );
};

export const initializeWorkflowEngine = async (
  userDataPath: string,
): Promise<void> => {
  persistenceFilePath = path.join(userDataPath, "workflow-pending-reviews.json");

  try {
    const content = await fs.readFile(persistenceFilePath, "utf8");
    const sessions = JSON.parse(content) as PendingWorkflowSession[];
    pendingSessions.clear();

    sessions.forEach((session) => {
      pendingSessions.set(session.sessionId, {
        ...session,
        variables: session.variables ?? createInitialVariables(session.workspacePath),
        pathTrace: session.pathTrace ?? [],
        loopState: session.loopState ?? {},
      });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await savePendingSessions();
      return;
    }

    throw error;
  }
};

const createResult = (
  state: WorkflowExecutionState,
  status: WorkflowRunResult["status"],
  startedAt: string,
  summary: string,
  sessionId?: string,
  pendingReview?: WorkflowPendingReview,
): WorkflowRunResult => ({
  status,
  startedAt,
  finishedAt: new Date().toISOString(),
  summary,
  steps: state.steps,
  variablesSnapshot: { ...state.variables },
  pathTrace: [...state.pathTrace],
  sessionId,
  pendingReview,
});

const createFailedResult = (
  state: WorkflowExecutionState,
  startedAt: string,
  summary: string,
  sessionId?: string,
): WorkflowRunResult => createResult(state, "failed", startedAt, summary, sessionId);

const setLatestOutput = (
  state: WorkflowExecutionState,
  nodeId: string,
  output: string,
): void => {
  state.latestOutput = output;
  state.variables.last_output = output;
  state.variables[`node.${nodeId}.output`] = output;
};

const readVariableValue = (
  expression: string,
  state: WorkflowExecutionState,
): string => {
  const key = expression.trim();
  if (!key) {
    return "";
  }

  if (key in state.variables) {
    return state.variables[key] ?? "";
  }

  return key;
};

const resolveTemplate = (
  template: string,
  state: WorkflowExecutionState,
): string =>
  template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey: string) =>
    readVariableValue(rawKey, state),
  );

const parseListValue = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      // Fallback to split mode below.
    }
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const chooseExit = (
  node: RuntimeNodeSpec,
  preferredBranchKey?: string,
  fallbackIndex = 0,
): RuntimeNodeExit | null => {
  if (preferredBranchKey) {
    const matched = node.next.find((exit) => exit.branchKey === preferredBranchKey);
    if (matched) {
      return matched;
    }
  }

  return node.next[fallbackIndex] ?? node.next[0] ?? null;
};

const appendPathTrace = (
  state: WorkflowExecutionState,
  node: RuntimeNodeSpec,
  title: string,
  summary: string,
  chosenExit?: RuntimeNodeExit | null,
): void => {
  state.pathTrace.push({
    nodeId: node.id,
    nodeKind: node.kind,
    title,
    summary,
    chosenExit: chosenExit ?? null,
  });
};

const buildStartNodeStep = (
  node: RuntimeNodeSpec,
  state: WorkflowExecutionState,
): WorkflowRunStep => {
  const inputTemplate = isStartNodeConfig(node.config)
    ? resolveTemplate(node.config.inputTemplate, state)
    : "";

  setLatestOutput(state, node.id, inputTemplate);

  return {
    nodeId: node.id,
    kind: node.kind,
    title: "开始节点已完成",
    summary: state.workspacePath
      ? `已加载工作区：${state.workspacePath}`
      : "当前未选择工作区，将仅使用节点配置继续推理。",
    output: `输入模板：${inputTemplate}`,
  };
};

const validateJsonSchema = (value: unknown, schema: unknown, pathLabel = "$"): string[] => {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  const candidate = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
  };
  const issues: string[] = [];

  if (candidate.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [`${pathLabel} 应为对象。`];
    }

    const objectValue = value as Record<string, unknown>;
    (candidate.required ?? []).forEach((field) => {
      if (!(field in objectValue)) {
        issues.push(`${pathLabel}.${field} 缺少必填字段。`);
      }
    });

    Object.entries(candidate.properties ?? {}).forEach(([key, childSchema]) => {
      if (key in objectValue) {
        issues.push(...validateJsonSchema(objectValue[key], childSchema, `${pathLabel}.${key}`));
      }
    });
  }

  if (candidate.type === "array") {
    if (!Array.isArray(value)) {
      return [`${pathLabel} 应为数组。`];
    }

    value.forEach((item, index) => {
      issues.push(...validateJsonSchema(item, candidate.items, `${pathLabel}[${index}]`));
    });
  }

  if (candidate.type === "string" && typeof value !== "string") {
    issues.push(`${pathLabel} 应为字符串。`);
  }

  if (candidate.type === "number" && typeof value !== "number") {
    issues.push(`${pathLabel} 应为数字。`);
  }

  if (candidate.type === "boolean" && typeof value !== "boolean") {
    issues.push(`${pathLabel} 应为布尔值。`);
  }

  return issues;
};

const extractJsonPayload = (content: string): unknown => {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const firstObjectIndex = trimmed.indexOf("{");
  const firstArrayIndex = trimmed.indexOf("[");
  const jsonStart =
    firstObjectIndex === -1
      ? firstArrayIndex
      : firstArrayIndex === -1
        ? firstObjectIndex
        : Math.min(firstObjectIndex, firstArrayIndex);

  if (jsonStart >= 0) {
    candidates.push(trimmed.slice(jsonStart));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("模型输出未返回合法 JSON。");
};

const evaluateConditionExpression = (
  expression: string,
): { passed: boolean; resolvedExpression: string } => {
  const normalized = expression.trim();

  const binaryPatterns = [
    { operator: " contains ", test: (left: string, right: string) => left.includes(right) },
    { operator: " startsWith ", test: (left: string, right: string) => left.startsWith(right) },
    { operator: " endsWith ", test: (left: string, right: string) => left.endsWith(right) },
    { operator: " == ", test: (left: string, right: string) => left === right },
    { operator: " != ", test: (left: string, right: string) => left !== right },
  ] as const;

  for (const pattern of binaryPatterns) {
    const index = normalized.indexOf(pattern.operator);
    if (index >= 0) {
      const left = normalized.slice(0, index).trim();
      const right = normalized.slice(index + pattern.operator.length).trim();
      return {
        passed: pattern.test(left, right),
        resolvedExpression: normalized,
      };
    }
  }

  return {
    passed:
      normalized.length > 0 &&
      normalized.toLowerCase() !== "false" &&
      normalized !== "0" &&
      normalized.toLowerCase() !== "no",
    resolvedExpression: normalized,
  };
};

const resolveWorkspaceTarget = (
  workspacePath: string,
  relativePathValue: string,
): string => {
  const workspaceRoot = path.resolve(workspacePath);
  const targetPath = path.resolve(workspaceRoot, relativePathValue);

  if (
    targetPath !== workspaceRoot &&
    !targetPath.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("工具节点仅读取工作区内的文件，当前路径超出了工作区范围。");
  }

  return targetPath;
};

const parseHeaders = (headersText: string): Record<string, string> =>
  headersText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((headers, line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0) {
        headers[line.slice(0, separatorIndex).trim()] = line
          .slice(separatorIndex + 1)
          .trim();
      }
      return headers;
    }, {});

const runToolNode = async (
  node: RuntimeNodeSpec,
  state: WorkflowExecutionState,
): Promise<WorkflowRunStep> => {
  if (!isToolNodeConfig(node.config)) {
    throw new Error(`工具节点 ${node.id} 的配置无效。`);
  }

  if (node.config.toolType === "workspace_file") {
    if (!state.workspacePath) {
      if (node.config.failureStrategy === "empty") {
        setLatestOutput(state, node.id, "");
        return {
          nodeId: node.id,
          kind: node.kind,
          title: "工具节点已回退为空输出",
          summary: "当前没有选择工作区，已按 empty 策略返回空文本。",
          output: "",
        };
      }

      throw new Error("工具节点需要工作区路径，但当前尚未选择工作区。");
    }

    const relativePathValue = resolveTemplate(node.config.relativePath, state);

    try {
      const targetPath = resolveWorkspaceTarget(state.workspacePath, relativePathValue);
      const buffer = await fs.readFile(targetPath);
      const output =
        node.config.encoding === "base64"
          ? buffer.toString("base64")
          : buffer.toString("utf8");

      setLatestOutput(state, node.id, output);
      state.variables[`node.${node.id}.path`] = relativePathValue;

      return {
        nodeId: node.id,
        kind: node.kind,
        title: "工具节点已完成",
        summary: `已读取工作区文件：${relativePathValue}`,
        output,
      };
    } catch (error) {
      if (node.config.failureStrategy === "empty") {
        setLatestOutput(state, node.id, "");
        return {
          nodeId: node.id,
          kind: node.kind,
          title: "工具节点已回退为空输出",
          summary:
            error instanceof Error
              ? `读取文件失败，已按 empty 策略继续：${error.message}`
              : "读取文件失败，已按 empty 策略继续。",
          output: "",
        };
      }

      throw error;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(resolveTemplate(node.config.url, state), {
      method: node.config.method,
      headers: parseHeaders(resolveTemplate(node.config.headersText, state)),
      body:
        node.config.method === "POST"
          ? resolveTemplate(node.config.bodyTemplate, state)
          : undefined,
      signal: controller.signal,
    });

    const output = await response.text();
    if (!response.ok && node.config.failureStrategy === "fail") {
      throw new Error(`HTTP ${response.status}：${output || "空响应"}`);
    }

    setLatestOutput(state, node.id, response.ok ? output : "");

    return {
      nodeId: node.id,
      kind: node.kind,
      title: response.ok ? "HTTP 工具节点已完成" : "HTTP 工具节点已回退为空输出",
      summary: response.ok
        ? `已调用 ${node.config.method} ${resolveTemplate(node.config.url, state)}`
        : `请求失败，已按 empty 策略继续：HTTP ${response.status}`,
      output: response.ok ? output : "",
    };
  } catch (error) {
    if (node.config.failureStrategy === "empty") {
      setLatestOutput(state, node.id, "");
      return {
        nodeId: node.id,
        kind: node.kind,
        title: "HTTP 工具节点已回退为空输出",
        summary:
          error instanceof Error
            ? `请求失败，已按 empty 策略继续：${error.message}`
            : "请求失败，已按 empty 策略继续。",
        output: "",
      };
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const runLlmNode = async (
  node: RuntimeNodeSpec,
  state: WorkflowExecutionState,
): Promise<WorkflowRunStep> => {
  if (!isLlmNodeConfig(node.config)) {
    throw new Error(`模型节点 ${node.id} 的配置无效。`);
  }

  const model = node.config.model.trim() || getDefaultRemoteModel();
  const systemPrompt = resolveTemplate(node.config.systemPrompt, state);
  const promptTemplate = resolveTemplate(node.config.promptTemplate, state);
  const workspaceInfo = state.workspacePath
    ? `当前工作区：${state.workspacePath}`
    : "当前没有选择工作区";
  const prompt = [
    "你正在执行一个桌面端 AI 工作流节点。",
    workspaceInfo,
    `上一节点输出：${state.latestOutput || "无"}`,
    `变量快照：${JSON.stringify(state.variables, null, 2)}`,
    promptTemplate,
    node.config.outputMode === "structured"
      ? `请只输出合法 JSON，必须满足以下 JSON Schema：\n${node.config.outputSchema}`
      : "默认使用中文回答，除非任务明确要求其他语言。",
  ].join("\n\n");

  const response = await generateWithRemoteModel({
    model,
    system: systemPrompt,
    prompt,
  });

  let output = response.content;
  let summary = `已通过服务器模型服务调用 ${response.model}，接口地址：${getModelServiceUrl()}。`;

  if (node.config.outputMode === "structured") {
    const parsed = extractJsonPayload(response.content);
    const schema = JSON.parse(node.config.outputSchema || "{}");
    const issues = validateJsonSchema(parsed, schema);

    if (issues.length > 0) {
      throw new Error(`结构化输出校验失败：${issues.join("；")}`);
    }

    output = JSON.stringify(parsed, null, 2);
    summary = `${summary} 输出已通过结构化校验。`;
  }

  setLatestOutput(state, node.id, output);

  return {
    nodeId: node.id,
    kind: node.kind,
    title: "模型节点已完成",
    summary,
    output,
  };
};

const runConditionNode = (
  node: RuntimeNodeSpec,
  state: WorkflowExecutionState,
): {
  step: WorkflowRunStep;
  chosenExit: RuntimeNodeExit | null;
} => {
  if (!isConditionNodeConfig(node.config)) {
    throw new Error(`条件节点 ${node.id} 的配置无效。`);
  }

  const resolvedExpression = resolveTemplate(node.config.expression, state);
  const evaluation = evaluateConditionExpression(resolvedExpression);
  const branchKey = evaluation.passed ? "true" : "false";
  const chosenExit = chooseExit(node, branchKey, evaluation.passed ? 0 : 1);
  const label = evaluation.passed ? node.config.trueLabel : node.config.falseLabel;
  const output = [
    `表达式：${node.config.expression}`,
    `求值后：${evaluation.resolvedExpression || "空表达式"}`,
    `结果：${evaluation.passed ? "满足" : "不满足"}`,
  ].join("\n");

  setLatestOutput(state, node.id, output);
  state.variables[`node.${node.id}.branch`] = branchKey;

  return {
    chosenExit,
    step: {
      nodeId: node.id,
      kind: node.kind,
      title: "条件节点已完成",
      summary: `条件求值结果为“${label}”，将走向 ${chosenExit?.target ?? "无后续分支"}。`,
      output,
    },
  };
};

const runLoopNode = (
  node: RuntimeNodeSpec,
  state: WorkflowExecutionState,
): {
  step: WorkflowRunStep;
  chosenExit: RuntimeNodeExit | null;
} => {
  if (!isLoopNodeConfig(node.config)) {
    throw new Error(`循环节点 ${node.id} 的配置无效。`);
  }

  const variableKey = node.config.itemsVariable.trim();
  const rawValue = variableKey.includes("{{")
    ? resolveTemplate(variableKey, state)
    : readVariableValue(variableKey, state);
  const existing = state.loopState[node.id];
  const items = existing?.items ?? parseListValue(rawValue);
  const nextIndex = existing ? existing.index + 1 : 0;

  if (nextIndex < items.length) {
    const currentItem = items[nextIndex];
    state.loopState[node.id] = {
      items,
      index: nextIndex,
      itemVariableName: node.config.itemVariableName,
    };
    state.variables[node.config.itemVariableName] = currentItem;
    setLatestOutput(state, node.id, currentItem);
    const chosenExit = chooseExit(node, node.config.itemBranchKey);

    return {
      chosenExit,
      step: {
        nodeId: node.id,
        kind: node.kind,
        title: "循环节点进入下一项",
        summary: `当前处理第 ${nextIndex + 1} 项，共 ${items.length} 项。`,
        output: currentItem,
      },
    };
  }

  delete state.loopState[node.id];
  delete state.variables[node.config.itemVariableName];
  setLatestOutput(state, node.id, rawValue);
  const chosenExit = chooseExit(node, node.config.doneBranchKey);

  return {
    chosenExit,
    step: {
      nodeId: node.id,
      kind: node.kind,
      title: "循环节点已完成",
      summary: `列表遍历结束，共处理 ${items.length} 项。`,
      output: rawValue,
    },
  };
};

const createPausedResult = (
  session: PendingWorkflowSession,
  reviewNode: RuntimeNodeSpec,
): WorkflowRunResult => {
  const instructions = isReviewNodeConfig(reviewNode.config)
    ? reviewNode.config.instructions
    : "";

  return {
    status: "paused",
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    summary: "工作流已暂停，等待人工审核后继续。",
    steps: session.steps,
    variablesSnapshot: { ...session.variables },
    pathTrace: [...session.pathTrace],
    sessionId: session.sessionId,
    pendingReview: {
      sessionId: session.sessionId,
      reviewNodeId: reviewNode.id,
      title: reviewNode.label || "人工审核",
      instructions,
      latestOutput: session.latestOutput,
      reviewNoteDraft: session.reviewNoteDraft || "",
      createdAt: session.createdAt,
      workspacePath: session.workspacePath,
      steps: session.steps,
      variablesSnapshot: { ...session.variables },
      pathTrace: [...session.pathTrace],
    },
  };
};

const executeFromNode = async (
  spec: WorkflowSpec,
  startNodeId: string,
  state: WorkflowExecutionState,
  session: { sessionId: string; startedAt: string },
): Promise<WorkflowRunResult> => {
  const visitCounts = new Map<string, number>();
  let currentNodeId: string | null = startNodeId;

  state.variables.workspace_path = state.workspacePath ?? "";
  state.variables.last_output = state.latestOutput;

  while (currentNodeId) {
    const currentCount = (visitCounts.get(currentNodeId) ?? 0) + 1;
    visitCounts.set(currentNodeId, currentCount);

    if (currentCount > 32) {
      throw new Error(`节点 ${currentNodeId} 被访问次数过多，请检查是否存在无法结束的循环。`);
    }

    const node = getNodeById(spec, currentNodeId);

    if (!node) {
      throw new Error(`未找到节点 ${currentNodeId}，请检查工作流连线。`);
    }

    switch (node.kind) {
      case "start": {
        const step = buildStartNodeStep(node, state);
        const chosenExit = chooseExit(node);
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, chosenExit);
        currentNodeId = chosenExit?.target ?? null;
        break;
      }

      case "tool": {
        const step = await runToolNode(node, state);
        const chosenExit = chooseExit(node);
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, chosenExit);
        currentNodeId = chosenExit?.target ?? null;
        break;
      }

      case "llm": {
        const step = await runLlmNode(node, state);
        const chosenExit = chooseExit(node);
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, chosenExit);
        currentNodeId = chosenExit?.target ?? null;
        break;
      }

      case "condition": {
        const { step, chosenExit } = runConditionNode(node, state);
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, chosenExit);
        currentNodeId = chosenExit?.target ?? null;
        break;
      }

      case "loop": {
        const { step, chosenExit } = runLoopNode(node, state);
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, chosenExit);
        currentNodeId = chosenExit?.target ?? null;
        break;
      }

      case "review": {
        const step: WorkflowRunStep = {
          nodeId: node.id,
          kind: node.kind,
          title: "审核节点等待人工确认",
          summary: "流程已经暂停，请在右侧待审核面板中确认后继续。",
          output: state.latestOutput,
        };
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, null);

        const pendingSession: PendingWorkflowSession = {
          sessionId: session.sessionId,
          spec,
          workspacePath: state.workspacePath,
          currentNodeId: node.id,
          latestOutput: state.latestOutput,
          reviewNoteDraft: state.variables.review_note ?? "",
          steps: state.steps,
          startedAt: session.startedAt,
          createdAt: new Date().toISOString(),
          variables: { ...state.variables },
          pathTrace: [...state.pathTrace],
          loopState: JSON.parse(JSON.stringify(state.loopState)),
        };

        pendingSessions.set(session.sessionId, pendingSession);
        await savePendingSessions();
        return createPausedResult(pendingSession, node);
      }

      case "end": {
        const outputFormat = isEndNodeConfig(node.config)
          ? node.config.outputFormat
          : "markdown";
        const step: WorkflowRunStep = {
          nodeId: node.id,
          kind: node.kind,
          title: "结束节点已完成",
          summary: `已整理最终输出，目标格式：${outputFormat}。`,
          output: state.latestOutput,
        };
        state.steps.push(step);
        appendPathTrace(state, node, step.title, step.summary, null);

        return createResult(
          state,
          "completed",
          session.startedAt,
          state.latestOutput ||
            "工作流已执行完成，但当前没有可展示的最终摘要，请检查结束节点输出。",
          session.sessionId,
        );
      }
    }
  }

  return createResult(
    state,
    "completed",
    session.startedAt,
    state.latestOutput || "工作流执行结束，但没有可展示的最终输出。",
    session.sessionId,
  );
};

export const executeWorkflow = async (
  payload: WorkflowRunRequest,
): Promise<WorkflowRunResult> => {
  const startedAt = new Date().toISOString();
  const state: WorkflowExecutionState = {
    latestOutput: "",
    steps: [],
    workspacePath: payload.workspacePath,
    variables: createInitialVariables(payload.workspacePath),
    pathTrace: [],
    loopState: {},
  };

  try {
    if (!payload.spec.entryNodeId) {
      throw new Error("工作流没有入口节点，请先添加开始节点并连线。");
    }

    return await executeFromNode(
      payload.spec,
      payload.spec.entryNodeId,
      state,
      {
        sessionId: createSessionId(),
        startedAt,
      },
    );
  } catch (error) {
    return createFailedResult(
      state,
      startedAt,
      error instanceof Error ? error.message : "工作流执行过程中发生未知错误。",
    );
  }
};

export const listPendingReviews = (): WorkflowPendingReview[] =>
  Array.from(pendingSessions.values()).map((session) => {
    const reviewNode = getNodeById(session.spec, session.currentNodeId);
    const instructions =
      reviewNode && isReviewNodeConfig(reviewNode.config)
        ? reviewNode.config.instructions
        : "";

    return {
      sessionId: session.sessionId,
      reviewNodeId: session.currentNodeId,
      title: reviewNode?.label || "人工审核",
      instructions,
      latestOutput: session.latestOutput,
      reviewNoteDraft: session.reviewNoteDraft || "",
      createdAt: session.createdAt,
      workspacePath: session.workspacePath,
      steps: session.steps,
      variablesSnapshot: { ...session.variables },
      pathTrace: [...session.pathTrace],
    };
  });

export const submitReviewDecision = async (
  payload: WorkflowReviewActionRequest,
): Promise<WorkflowRunResult> => {
  const session = pendingSessions.get(payload.sessionId);
  const reviewNote =
    payload.reviewNote?.trim() || session?.reviewNoteDraft?.trim() || "";

  if (!session) {
    return {
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      summary: `未找到待审核会话 ${payload.sessionId}。`,
      steps: [],
      variablesSnapshot: {},
      pathTrace: [],
      sessionId: payload.sessionId,
    };
  }

  const reviewNode = getNodeById(session.spec, session.currentNodeId);

  if (!reviewNode) {
    pendingSessions.delete(payload.sessionId);
    await savePendingSessions();
    return {
      status: "failed",
      startedAt: session.startedAt,
      finishedAt: new Date().toISOString(),
      summary: "待审核节点不存在，流程已无法恢复。",
      steps: session.steps,
      variablesSnapshot: { ...session.variables },
      pathTrace: [...session.pathTrace],
      sessionId: payload.sessionId,
    };
  }

  const state: WorkflowExecutionState = {
    latestOutput: session.latestOutput,
    steps: [...session.steps],
    workspacePath: session.workspacePath,
    variables: { ...session.variables, review_note: reviewNote },
    pathTrace: [...session.pathTrace],
    loopState: JSON.parse(JSON.stringify(session.loopState ?? {})),
  };

  if (payload.decision === "rejected") {
    const instructions = isReviewNodeConfig(reviewNode.config)
      ? reviewNode.config.instructions
      : "";
    const step: WorkflowRunStep = {
      nodeId: reviewNode.id,
      kind: reviewNode.kind,
      title: "审核未通过，工作流已终止",
      summary: "操作者驳回了当前审核任务，本次流程已停止。",
      output: reviewNote
        ? `审核说明：${instructions}\n审核备注：${reviewNote}`
        : `审核说明：${instructions}`,
    };

    state.steps.push(step);
    appendPathTrace(state, reviewNode, step.title, step.summary, null);
    pendingSessions.delete(payload.sessionId);
    await savePendingSessions();

    return createFailedResult(state, session.startedAt, "人工审核未通过，工作流已终止。", payload.sessionId);
  }

  const approvedExit = chooseExit(reviewNode, "approved");
  const instructions = isReviewNodeConfig(reviewNode.config)
    ? reviewNode.config.instructions
    : "";
  const step: WorkflowRunStep = {
    nodeId: reviewNode.id,
    kind: reviewNode.kind,
    title: "审核已通过，继续执行",
    summary: "操作者确认通过，流程将从下一节点继续。",
    output: reviewNote
      ? `审核说明：${instructions}\n审核备注：${reviewNote}`
      : `审核说明：${instructions}`,
  };

  state.steps.push(step);
  appendPathTrace(state, reviewNode, step.title, step.summary, approvedExit);
  pendingSessions.delete(payload.sessionId);
  await savePendingSessions();
  state.latestOutput = reviewNote
    ? `【审核通过】\n审核备注：${reviewNote}\n${session.latestOutput}`
    : `【审核通过】\n${session.latestOutput}`;
  state.variables.last_output = state.latestOutput;

  if (!approvedExit) {
    return createResult(
      state,
      "completed",
      session.startedAt,
      session.latestOutput || "审核已通过，流程结束。",
      payload.sessionId,
    );
  }

  try {
    return await executeFromNode(
      session.spec,
      approvedExit.target,
      state,
      {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
      },
    );
  } catch (error) {
    return createFailedResult(
      state,
      session.startedAt,
      error instanceof Error ? error.message : "审核恢复执行时发生未知错误。",
      payload.sessionId,
    );
  }
};

export const updateReviewDraft = async (
  payload: WorkflowReviewDraftUpdateRequest,
): Promise<WorkflowPendingReview[]> => {
  const session = pendingSessions.get(payload.sessionId);

  if (!session) {
    return listPendingReviews();
  }

  session.reviewNoteDraft = payload.reviewNoteDraft;
  session.variables.review_note = payload.reviewNoteDraft;
  pendingSessions.set(payload.sessionId, session);
  await savePendingSessions();

  return listPendingReviews();
};
