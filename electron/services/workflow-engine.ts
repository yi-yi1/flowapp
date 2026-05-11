import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeNodeSpec, WorkflowSpec } from "../../shared/compiler";
import type {
  WorkflowPendingReview,
  WorkflowReviewActionRequest,
  WorkflowReviewDraftUpdateRequest,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowRunStep,
} from "../../shared/runtime";
import {
  generateWithRemoteModel,
  getDefaultRemoteModel,
  getModelServiceUrl,
} from "./model-service";

type WorkflowExecutionState = {
  latestOutput: string;
  steps: WorkflowRunStep[];
  workspacePath: string | null;
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
};

const pendingSessions = new Map<string, PendingWorkflowSession>();
let persistenceFilePath: string | null = null;

const createSessionId = (): string =>
  `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getNodeById = (
  spec: WorkflowSpec,
  nodeId: string,
): RuntimeNodeSpec | undefined => spec.nodes.find((node) => node.id === nodeId);

const getNextNodeId = (node: RuntimeNodeSpec): string | null => node.next[0] ?? null;

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
      pendingSessions.set(session.sessionId, session);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await savePendingSessions();
      return;
    }

    throw error;
  }
};

const buildStartNodeStep = (
  node: RuntimeNodeSpec,
  workspacePath: string | null,
): WorkflowRunStep => {
  const inputTemplate =
    "inputTemplate" in node.config ? node.config.inputTemplate : "";

  return {
    nodeId: node.id,
    kind: node.kind,
    title: "开始节点已完成",
    summary: workspacePath
      ? `已加载工作区：${workspacePath}`
      : "当前未选择工作区，将仅使用节点配置继续推理。",
    output: `输入模板：${inputTemplate}`,
  };
};

const createPausedResult = (
  session: PendingWorkflowSession,
  reviewNode: RuntimeNodeSpec,
): WorkflowRunResult => {
  const instructions =
    "instructions" in reviewNode.config ? reviewNode.config.instructions : "";

  return {
    status: "paused",
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    summary: "工作流已暂停，等待人工审核后继续。",
    steps: session.steps,
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
    },
  };
};

const executeFromNode = async (
  spec: WorkflowSpec,
  startNodeId: string,
  state: WorkflowExecutionState,
  session: { sessionId: string; startedAt: string },
): Promise<WorkflowRunResult> => {
  const visited = new Set<string>();
  let currentNodeId: string | null = startNodeId;

  while (currentNodeId) {
    if (visited.has(currentNodeId)) {
      throw new Error(`检测到循环节点 ${currentNodeId}，当前运行时暂不支持循环恢复。`);
    }

    visited.add(currentNodeId);
    const node = getNodeById(spec, currentNodeId);

    if (!node) {
      throw new Error(`未找到节点 ${currentNodeId}，请检查工作流连线。`);
    }

    switch (node.kind) {
      case "start": {
        const step = buildStartNodeStep(node, state.workspacePath);
        const inputTemplate =
          "inputTemplate" in node.config ? node.config.inputTemplate : "";
        state.latestOutput = inputTemplate;
        state.steps.push(step);
        currentNodeId = getNextNodeId(node);
        break;
      }

      case "llm": {
        const model =
          "model" in node.config && node.config.model.trim()
            ? node.config.model.trim()
            : getDefaultRemoteModel();
        const systemPrompt =
          "systemPrompt" in node.config ? node.config.systemPrompt : "";
        const workspaceInfo = state.workspacePath
          ? `当前工作区：${state.workspacePath}`
          : "当前没有选择工作区";
        const prompt = [
          "你正在执行一个桌面端 AI 工作流节点。",
          workspaceInfo,
          `上一节点输出：${state.latestOutput || "无"}`,
          "请给出当前节点的执行结果，并明确说明下一步应该做什么。",
          "默认使用中文回答，除非任务明确要求其他语言。",
        ].join("\n");

        const response = await generateWithRemoteModel({
          model,
          system: systemPrompt,
          prompt,
        });

        state.latestOutput = response.content;
        state.steps.push({
          nodeId: node.id,
          kind: node.kind,
          title: "模型节点已完成",
          summary: `已通过服务器模型服务调用 ${response.model}，接口地址：${getModelServiceUrl()}。`,
          output: response.content,
        });
        currentNodeId = getNextNodeId(node);
        break;
      }

      case "review": {
        state.steps.push({
          nodeId: node.id,
          kind: node.kind,
          title: "审核节点等待人工确认",
          summary: "流程已经暂停，请在右侧待审核面板中确认后继续。",
          output: state.latestOutput,
        });

        const pendingSession: PendingWorkflowSession = {
          sessionId: session.sessionId,
          spec,
          workspacePath: state.workspacePath,
          currentNodeId: node.id,
          latestOutput: state.latestOutput,
          reviewNoteDraft: "",
          steps: state.steps,
          startedAt: session.startedAt,
          createdAt: new Date().toISOString(),
        };

        pendingSessions.set(session.sessionId, pendingSession);
        await savePendingSessions();
        return createPausedResult(pendingSession, node);
      }

      case "end": {
        const outputFormat =
          "outputFormat" in node.config ? node.config.outputFormat : "markdown";
        state.steps.push({
          nodeId: node.id,
          kind: node.kind,
          title: "结束节点已完成",
          summary: `已整理最终输出，目标格式：${outputFormat}。`,
          output: state.latestOutput,
        });

        return {
          status: "completed",
          startedAt: session.startedAt,
          finishedAt: new Date().toISOString(),
          summary:
            state.latestOutput ||
            "工作流已执行完成，但当前没有可展示的最终摘要，请检查结束节点输出。",
          steps: state.steps,
          sessionId: session.sessionId,
        };
      }

      default: {
        state.steps.push({
          nodeId: node.id,
          kind: node.kind,
          title: "未支持的节点类型",
          summary: "当前运行时还未实现该节点类型。",
        });
        currentNodeId = getNextNodeId(node);
      }
    }
  }

  return {
    status: "completed",
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    summary: state.latestOutput || "工作流执行结束，但没有可展示的最终输出。",
    steps: state.steps,
    sessionId: session.sessionId,
  };
};

export const executeWorkflow = async (
  payload: WorkflowRunRequest,
): Promise<WorkflowRunResult> => {
  const startedAt = new Date().toISOString();

  try {
    if (!payload.spec.entryNodeId) {
      throw new Error("工作流没有入口节点，请先添加开始节点并连线。");
    }

    return await executeFromNode(
      payload.spec,
      payload.spec.entryNodeId,
      {
        latestOutput: "",
        steps: [],
        workspacePath: payload.workspacePath,
      },
      {
        sessionId: createSessionId(),
        startedAt,
      },
    );
  } catch (error) {
    return {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      summary:
        error instanceof Error ? error.message : "工作流执行过程中发生未知错误。",
      steps: [],
    };
  }
};

export const listPendingReviews = (): WorkflowPendingReview[] =>
  Array.from(pendingSessions.values()).map((session) => {
    const reviewNode = getNodeById(session.spec, session.currentNodeId);
    const instructions =
      reviewNode && "instructions" in reviewNode.config
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
      sessionId: payload.sessionId,
    };
  }

  if (payload.decision === "rejected") {
    const instructions =
      "instructions" in reviewNode.config ? reviewNode.config.instructions : "";
    const steps = session.steps.concat({
      nodeId: reviewNode.id,
      kind: reviewNode.kind,
      title: "审核未通过，工作流已终止",
      summary: "操作者驳回了当前审核任务，本次流程已停止。",
      output: reviewNote
        ? `审核说明：${instructions}\n审核备注：${reviewNote}`
        : `审核说明：${instructions}`,
    });

    pendingSessions.delete(payload.sessionId);
    await savePendingSessions();

    return {
      status: "failed",
      startedAt: session.startedAt,
      finishedAt: new Date().toISOString(),
      summary: "人工审核未通过，工作流已终止。",
      steps,
      sessionId: payload.sessionId,
    };
  }

  const nextNodeId = getNextNodeId(reviewNode);
  const instructions =
    "instructions" in reviewNode.config ? reviewNode.config.instructions : "";
  const updatedSteps = session.steps.concat({
    nodeId: reviewNode.id,
    kind: reviewNode.kind,
    title: "审核已通过，继续执行",
    summary: "操作者确认通过，流程将从下一节点继续。",
    output: reviewNote
      ? `审核说明：${instructions}\n审核备注：${reviewNote}`
      : `审核说明：${instructions}`,
  });

  pendingSessions.delete(payload.sessionId);
  await savePendingSessions();

  if (!nextNodeId) {
    return {
      status: "completed",
      startedAt: session.startedAt,
      finishedAt: new Date().toISOString(),
      summary: session.latestOutput || "审核已通过，流程结束。",
      steps: updatedSteps,
      sessionId: payload.sessionId,
    };
  }

  return executeFromNode(
    session.spec,
    nextNodeId,
    {
      latestOutput: reviewNote
        ? `【审核通过】\n审核备注：${reviewNote}\n${session.latestOutput}`
        : `【审核通过】\n${session.latestOutput}`,
      steps: updatedSteps,
      workspacePath: session.workspacePath,
    },
    {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
    },
  );
};

export const updateReviewDraft = async (
  payload: WorkflowReviewDraftUpdateRequest,
): Promise<WorkflowPendingReview[]> => {
  const session = pendingSessions.get(payload.sessionId);

  if (!session) {
    return listPendingReviews();
  }

  session.reviewNoteDraft = payload.reviewNoteDraft;
  pendingSessions.set(payload.sessionId, session);
  await savePendingSessions();

  return listPendingReviews();
};
