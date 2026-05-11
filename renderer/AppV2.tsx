import { useEffect, useMemo, useState } from "react";
import { toWorkflowSpec } from "../shared/compiler";
import type { WorkflowEditorDraft } from "../shared/editor-state";
import {
  defaultWorkflowModelSettings,
  type WorkflowModelSettings,
} from "../shared/model-settings";
import type {
  WorkflowPendingReview,
  WorkflowReviewDecision,
  WorkflowRunHistoryItem,
  WorkflowRunResult,
} from "../shared/runtime";
import {
  createNode,
  initialEdges,
  initialNodes,
  isConditionNodeConfig,
  isEndNodeConfig,
  isLlmNodeConfig,
  isLoopNodeConfig,
  isReviewNodeConfig,
  isStartNodeConfig,
  isToolNodeConfig,
  type FlowEdge,
  type FlowNode,
  type HttpRequestToolConfig,
  type NodeKind,
  type WorkspaceFileToolConfig,
} from "../shared/workflow";
import {
  collectActiveEdgeIds,
  WorkflowCanvasV2,
} from "./components/WorkflowCanvasV2";

type AppInfo = Awaited<ReturnType<typeof window.electronAPI.getAppInfo>>;
type ThemeMode = "dark" | "light";

const kindButtonOrder: NodeKind[] = [
  "start",
  "tool",
  "llm",
  "condition",
  "review",
  "loop",
  "end",
];

const kindTextMap: Record<NodeKind, string> = {
  start: "开始节点",
  tool: "工具节点",
  llm: "模型节点",
  condition: "条件节点",
  review: "审核节点",
  loop: "循环节点",
  end: "结束节点",
};

const statusTextMap = {
  completed: "已完成",
  paused: "待审核",
  failed: "执行失败",
} as const;

const kindCardClassName: Record<ThemeMode, Record<NodeKind, string>> = {
  dark: {
    start: "border-emerald-300/35 bg-emerald-400/10 text-emerald-100",
    tool: "border-cyan-300/35 bg-cyan-400/10 text-cyan-100",
    llm: "border-sky-300/35 bg-sky-400/10 text-sky-100",
    condition: "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100",
    review: "border-amber-300/35 bg-amber-400/10 text-amber-100",
    loop: "border-violet-300/35 bg-violet-400/10 text-violet-100",
    end: "border-rose-300/35 bg-rose-400/10 text-rose-100",
  },
  light: {
    start:
      "border-emerald-400/45 bg-[linear-gradient(180deg,rgba(225,246,234,0.96),rgba(214,240,224,0.96))] text-emerald-950",
    tool:
      "border-cyan-400/45 bg-[linear-gradient(180deg,rgba(228,246,250,0.96),rgba(215,238,244,0.96))] text-cyan-950",
    llm:
      "border-sky-400/45 bg-[linear-gradient(180deg,rgba(229,243,252,0.96),rgba(217,235,248,0.96))] text-sky-950",
    condition:
      "border-fuchsia-400/45 bg-[linear-gradient(180deg,rgba(248,236,251,0.96),rgba(239,223,247,0.96))] text-fuchsia-950",
    review:
      "border-amber-400/50 bg-[linear-gradient(180deg,rgba(253,245,222,0.98),rgba(249,235,196,0.98))] text-amber-950",
    loop:
      "border-violet-400/45 bg-[linear-gradient(180deg,rgba(239,236,253,0.98),rgba(226,220,248,0.98))] text-violet-950",
    end:
      "border-rose-400/45 bg-[linear-gradient(180deg,rgba(252,235,238,0.98),rgba(247,221,227,0.98))] text-rose-950",
  },
};

const statusBadgeClassMap: Record<keyof typeof statusTextMap, string> = {
  completed: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  paused: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  failed: "border-rose-300/25 bg-rose-400/10 text-rose-100",
};

const consoleButtonClassMap: Record<
  ThemeMode,
  Record<"ping" | "workspace" | "import" | "export" | "template" | "run" | "reset", string>
> = {
  dark: {
    ping: "border-[#89b8d6]/25 bg-[#89b8d6]/10 text-[#d5ebf5] hover:border-[#89b8d6]/45",
    workspace:
      "border-[#d8a35d]/25 bg-[#d8a35d]/10 text-[#f2d2a2] hover:border-[#d8a35d]/45",
    import: "border-[#7d96cf]/25 bg-[#7d96cf]/10 text-[#dce4ff] hover:border-[#7d96cf]/45",
    export: "border-[#4da187]/25 bg-[#4da187]/10 text-[#cbf0e0] hover:border-[#4da187]/45",
    template:
      "border-violet-300/25 bg-violet-400/10 text-violet-100 hover:border-violet-200/45",
    run: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:border-emerald-200/45",
    reset: "border-rose-300/25 bg-rose-400/10 text-rose-100 hover:border-rose-200/45",
  },
  light: {
    ping: "border-[#6e95af]/25 bg-[#6e95af]/10 text-[#31556b] hover:border-[#6e95af]/45",
    workspace:
      "border-[#a67027]/25 bg-[#a67027]/10 text-[#7a531c] hover:border-[#a67027]/45",
    import: "border-[#5a73b5]/25 bg-[#5a73b5]/10 text-[#324780] hover:border-[#5a73b5]/45",
    export: "border-[#3c8972]/25 bg-[#3c8972]/10 text-[#1f5d4b] hover:border-[#3c8972]/45",
    template:
      "border-violet-500/25 bg-violet-500/10 text-violet-800 hover:border-violet-500/40",
    run: "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 hover:border-emerald-500/40",
    reset: "border-rose-500/25 bg-rose-500/10 text-rose-800 hover:border-rose-500/40",
  },
};

const panelClass = (isDark: boolean) =>
  isDark
    ? "border border-white/8 bg-[linear-gradient(180deg,rgba(10,12,15,0.92),rgba(17,20,24,0.92))]"
    : "border border-black/8 bg-[linear-gradient(180deg,rgba(255,249,241,0.96),rgba(246,238,227,0.96))]";

const inputClass = (isDark: boolean) =>
  `w-full rounded-2xl px-4 py-3 text-sm outline-none transition ${
    isDark
      ? "border border-white/10 bg-[#0c1114] text-white focus:border-cyan-300/40"
      : "border border-black/10 bg-white/75 text-[#2f241b] focus:border-[#a67027]/35"
  }`;

const surfaceClass = (isDark: boolean) =>
  isDark ? "border border-white/8 bg-white/5" : "border border-black/8 bg-black/[0.03]";

const sectionTitleClass = "text-xs uppercase tracking-[0.2em] text-[var(--text-soft)]";

const createEdgeId = (edges: FlowEdge[]) =>
  `edge-${edges.length + 1}-${Math.random().toString(36).slice(2, 6)}`;

const defaultHttpToolConfig = (): HttpRequestToolConfig => ({
  toolType: "http_request",
  method: "GET",
  url: "https://example.com",
  headersText: "Accept: application/json",
  bodyTemplate: "",
  failureStrategy: "empty",
});

const defaultWorkspaceToolConfig = (): WorkspaceFileToolConfig => ({
  toolType: "workspace_file",
  relativePath: "README.md",
  encoding: "utf8",
  failureStrategy: "empty",
});

const jsonPreview = (value: unknown) => JSON.stringify(value, null, 2);

export const AppV2 = () => {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [nodes, setNodes] = useState<FlowNode[]>(initialNodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodes[0]?.id ?? null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowRunHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [pendingReviews, setPendingReviews] = useState<WorkflowPendingReview[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [modelSettings, setModelSettings] = useState<WorkflowModelSettings>(
    defaultWorkflowModelSettings,
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [isSavingModelSettings, setIsSavingModelSettings] = useState(false);
  const [isTestingModelConnection, setIsTestingModelConnection] = useState(false);
  const [isImportingWorkflow, setIsImportingWorkflow] = useState(false);
  const [isExportingWorkflow, setIsExportingWorkflow] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    "渲染进程已启动，正在等待 preload 安全桥与主进程握手。",
  ]);

  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null;
  const compiledSpec = useMemo(() => toWorkflowSpec(nodes, edges), [nodes, edges]);
  const isDark = theme === "dark";
  const currentDraft: WorkflowEditorDraft = {
    nodes,
    edges,
    selectedNodeId,
    workspacePath,
    theme,
  };
  const selectedHistoryItem =
    workflowHistory.find((item) => item.id === selectedHistoryId) ??
    workflowHistory[0] ??
    null;
  const currentVariables =
    runResult?.variablesSnapshot ??
    selectedHistoryItem?.variablesSnapshot ??
    pendingReviews[0]?.variablesSnapshot ??
    null;
  const currentPathTrace =
    runResult?.pathTrace ?? selectedHistoryItem?.pathTrace ?? pendingReviews[0]?.pathTrace ?? [];
  const activeEdgeIds = collectActiveEdgeIds(currentPathTrace);

  const appendLog = (message: string) => {
    setLogs((current) => [...current, message]);
  };

  const refreshPendingReviews = async () => {
    const reviews = await window.electronAPI.listPendingReviews();
    setPendingReviews(reviews);
    setReviewNotes((current) => {
      const next = { ...current };
      reviews.forEach((review) => {
        next[review.sessionId] = current[review.sessionId] ?? review.reviewNoteDraft ?? "";
      });
      Object.keys(next).forEach((sessionId) => {
        if (!reviews.some((review) => review.sessionId === sessionId)) {
          delete next[sessionId];
        }
      });
      return next;
    });
  };

  const refreshWorkflowHistory = async () => {
    const items = await window.electronAPI.listWorkflowHistory();
    setWorkflowHistory(items);
    setSelectedHistoryId((current) => {
      if (items.length === 0) {
        return null;
      }
      return current && items.some((item) => item.id === current) ? current : items[0].id;
    });
  };

  useEffect(() => {
    document.title = "妙流 AI 编排台";
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const initialize = async () => {
      const info = await window.electronAPI.getAppInfo();
      setAppInfo(info);
      appendLog(`桌面容器已就绪：${info.platform} / Electron ${info.versions.electron}`);

      const settings = await window.electronAPI.getModelSettings();
      setModelSettings(settings);
      appendLog(`已加载模型服务配置：${settings.serviceUrl}`);

      const draft = await window.electronAPI.loadWorkflowDraft();
      if (draft) {
        setNodes(draft.nodes);
        setEdges(draft.edges);
        setSelectedNodeId(draft.selectedNodeId ?? draft.nodes[0]?.id ?? null);
        setWorkspacePath(draft.workspacePath);
        setTheme(draft.theme);
        appendLog("已恢复上次编辑草稿。");
      }

      await refreshPendingReviews();
      await refreshWorkflowHistory();
    };

    void initialize();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.electronAPI.saveWorkflowDraft(currentDraft);
    }, 400);
    return () => clearTimeout(timer);
  }, [currentDraft]);

  useEffect(() => {
    const timers = pendingReviews.map((review) =>
      setTimeout(() => {
        const currentDraftValue = reviewNotes[review.sessionId];
        if (
          currentDraftValue !== undefined &&
          currentDraftValue !== (review.reviewNoteDraft ?? "")
        ) {
          void window.electronAPI
            .updateReviewDraft({
              sessionId: review.sessionId,
              reviewNoteDraft: currentDraftValue,
            })
            .then((reviews) => setPendingReviews(reviews));
        }
      }, 400),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [pendingReviews, reviewNotes]);

  const addNode = (kind: NodeKind) => {
    const nextNode = createNode(kind, nodes.length);
    setNodes((current) => [...current, nextNode]);
    setSelectedNodeId(nextNode.id);
    appendLog(`已添加${kindTextMap[kind]}：${nextNode.id}`);
  };

  const updateSelectedNode = (partial: Partial<FlowNode>) => {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id ? { ...node, ...partial } : node,
      ),
    );
  };

  const updateSelectedNodeConfig = (config: FlowNode["config"]) => {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id ? { ...node, config } : node,
      ),
    );
  };

  const updateNodePosition = (nodeId: string, position: FlowNode["position"]) => {
    setNodes((current) =>
      current.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    );
  };

  const updateEdge = (edgeId: string, partial: Partial<FlowEdge>) => {
    setEdges((current) =>
      current.map((edge) => (edge.id === edgeId ? { ...edge, ...partial } : edge)),
    );
  };

  const addEdge = () => {
    const source = selectedNode?.id ?? nodes[0]?.id;
    const target = nodes.find((node) => node.id !== source)?.id ?? nodes[0]?.id;
    if (!source || !target) {
      return;
    }
    setEdges((current) => [
      ...current,
      { id: createEdgeId(current), source, target, label: "新连线" },
    ]);
  };

  const removeEdge = (edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  };

  const resetWorkflow = async () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNodeId(initialNodes[0]?.id ?? null);
    setWorkspacePath(null);
    setRunResult(null);
    setTheme("dark");
    await window.electronAPI.clearWorkflowDraft();
    appendLog("已恢复默认工作流草稿。");
  };

  const handlePing = async () => {
    const result = await window.electronAPI.ping();
    appendLog(`主进程回执：${result}`);
  };

  const handleOpenDirectory = async () => {
    const selected = await window.electronAPI.openDirectory();
    if (!selected) {
      appendLog("你取消了工作区选择。");
      return;
    }
    setWorkspacePath(selected);
    appendLog(`工作区已更新：${selected}`);
  };

  const handleRunWorkflow = async () => {
    setIsRunning(true);
    setRunResult(null);
    appendLog("开始运行当前工作流。");
    try {
      const result = await window.electronAPI.runWorkflow({
        spec: compiledSpec,
        workspacePath,
      });
      setRunResult(result);
      appendLog(`工作流运行结束：${statusTextMap[result.status]}`);
      await refreshPendingReviews();
      await refreshWorkflowHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作流运行时发生未知错误。";
      appendLog(`运行失败：${message}`);
      setRunResult({
        status: "failed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: message,
        steps: [],
        variablesSnapshot: {},
        pathTrace: [],
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleReviewDecision = async (
    sessionId: string,
    decision: WorkflowReviewDecision,
  ) => {
    setIsSubmittingReview(true);
    try {
      const result = await window.electronAPI.submitReviewDecision({
        sessionId,
        decision,
        reviewNote: reviewNotes[sessionId] ?? "",
      });
      setRunResult(result);
      appendLog(
        decision === "approved" ? `审核已通过：${sessionId}` : `审核已驳回：${sessionId}`,
      );
      await refreshPendingReviews();
      await refreshWorkflowHistory();
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleSaveModelSettings = async () => {
    setIsSavingModelSettings(true);
    try {
      const saved = await window.electronAPI.saveModelSettings(modelSettings);
      setModelSettings(saved);
      appendLog("模型服务配置已保存。");
    } finally {
      setIsSavingModelSettings(false);
    }
  };

  const handleTestModelConnection = async () => {
    setIsTestingModelConnection(true);
    try {
      const result = await window.electronAPI.testModelConnection(modelSettings);
      appendLog(`模型服务连接成功：${result.model} / ${result.preview}`);
    } finally {
      setIsTestingModelConnection(false);
    }
  };

  const handleImportWorkflow = async () => {
    setIsImportingWorkflow(true);
    try {
      const imported = await window.electronAPI.importWorkflowJson();
      if (!imported) {
        appendLog("你取消了工作流导入。");
        return;
      }
      setNodes(imported.draft.nodes);
      setEdges(imported.draft.edges);
      setSelectedNodeId(imported.draft.selectedNodeId ?? imported.draft.nodes[0]?.id ?? null);
      setWorkspacePath(imported.draft.workspacePath);
      setTheme(imported.draft.theme);
      setRunResult(null);
      appendLog(
        `已导入${imported.documentKind === "template" ? "模板" : "工作流"}：${imported.name}`,
      );
    } finally {
      setIsImportingWorkflow(false);
    }
  };

  const handleExportWorkflow = async (kind: "workflow" | "template") => {
    setIsExportingWorkflow(true);
    try {
      const filePath = await window.electronAPI.exportWorkflowJson({
        name: kind === "template" ? "workflow-template" : "workflow-document",
        draft: currentDraft,
        kind,
      });
      if (filePath) {
        appendLog(`${kind === "template" ? "模板" : "工作流"}已导出：${filePath}`);
      }
    } finally {
      setIsExportingWorkflow(false);
    }
  };

  const handleClearWorkflowHistory = async () => {
    await window.electronAPI.clearWorkflowHistory();
    setWorkflowHistory([]);
    setSelectedHistoryId(null);
    appendLog("运行历史已清空。");
  };

  const handleExportWorkflowHistory = async (format: "markdown" | "json") => {
    if (!selectedHistoryItem) {
      return;
    }
    const filePath = await window.electronAPI.exportWorkflowHistory({
      item: selectedHistoryItem,
      format,
    });
    if (filePath) {
      appendLog(`历史记录已导出：${filePath}`);
    }
  };

  const renderSelectedNodeConfig = () => {
    if (!selectedNode) {
      return (
        <p className="mt-4 text-sm leading-7 text-[var(--text-dim)]">
          先从中间画布选择一个节点，再在这里调整参数。
        </p>
      );
    }

    const config = selectedNode.config;

    return (
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className={sectionTitleClass}>节点标题</span>
          <input
            value={selectedNode.label}
            onChange={(event) => updateSelectedNode({ label: event.target.value })}
            className={`${inputClass(isDark)} mt-2`}
          />
        </label>
        <label className="block">
          <span className={sectionTitleClass}>节点说明</span>
          <textarea
            rows={3}
            value={selectedNode.description}
            onChange={(event) => updateSelectedNode({ description: event.target.value })}
            className={`${inputClass(isDark)} mt-2`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={sectionTitleClass}>X 坐标</span>
            <input
              type="number"
              value={selectedNode.position.x}
              onChange={(event) =>
                updateSelectedNode({
                  position: {
                    ...selectedNode.position,
                    x: Number(event.target.value) || 0,
                  },
                })
              }
              className={`${inputClass(isDark)} mt-2`}
            />
          </label>
          <label className="block">
            <span className={sectionTitleClass}>Y 坐标</span>
            <input
              type="number"
              value={selectedNode.position.y}
              onChange={(event) =>
                updateSelectedNode({
                  position: {
                    ...selectedNode.position,
                    y: Number(event.target.value) || 0,
                  },
                })
              }
              className={`${inputClass(isDark)} mt-2`}
            />
          </label>
        </div>

        {isStartNodeConfig(config) ? (
          <label className="block">
            <span className={sectionTitleClass}>输入模板</span>
            <textarea
              rows={4}
              value={config.inputTemplate}
              onChange={(event) =>
                updateSelectedNodeConfig({
                  ...config,
                  inputTemplate: event.target.value,
                })
              }
              className={`${inputClass(isDark)} mt-2`}
            />
          </label>
        ) : null}

        {isLlmNodeConfig(config) ? (
          <>
            <label className="block">
              <span className={sectionTitleClass}>模型名称</span>
              <input
                value={config.model}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    model: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <label className="block">
              <span className={sectionTitleClass}>系统提示词</span>
              <textarea
                rows={4}
                value={config.systemPrompt}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    systemPrompt: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <label className="block">
              <span className={sectionTitleClass}>节点提示模板</span>
              <textarea
                rows={4}
                value={config.promptTemplate}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    promptTemplate: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <label className="block">
              <span className={sectionTitleClass}>输出模式</span>
              <select
                value={config.outputMode}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    outputMode: event.target.value as typeof config.outputMode,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              >
                <option value="text">文本输出</option>
                <option value="structured">结构化输出</option>
              </select>
            </label>
            {config.outputMode === "structured" ? (
              <label className="block">
                <span className={sectionTitleClass}>JSON Schema</span>
                <textarea
                  rows={8}
                  value={config.outputSchema}
                  onChange={(event) =>
                    updateSelectedNodeConfig({
                      ...config,
                      outputSchema: event.target.value,
                    })
                  }
                  className={`${inputClass(isDark)} mt-2 font-mono text-xs`}
                />
              </label>
            ) : null}
          </>
        ) : null}

        {isConditionNodeConfig(config) ? (
          <>
            <label className="block">
              <span className={sectionTitleClass}>条件表达式</span>
              <input
                value={config.expression}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    expression: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={sectionTitleClass}>真分支名称</span>
                <input
                  value={config.trueLabel}
                  onChange={(event) =>
                    updateSelectedNodeConfig({
                      ...config,
                      trueLabel: event.target.value,
                    })
                  }
                  className={`${inputClass(isDark)} mt-2`}
                />
              </label>
              <label className="block">
                <span className={sectionTitleClass}>假分支名称</span>
                <input
                  value={config.falseLabel}
                  onChange={(event) =>
                    updateSelectedNodeConfig({
                      ...config,
                      falseLabel: event.target.value,
                    })
                  }
                  className={`${inputClass(isDark)} mt-2`}
                />
              </label>
            </div>
          </>
        ) : null}

        {isToolNodeConfig(config) ? (
          <>
            <label className="block">
              <span className={sectionTitleClass}>工具类型</span>
              <select
                value={config.toolType}
                onChange={(event) =>
                  updateSelectedNodeConfig(
                    event.target.value === "workspace_file"
                      ? defaultWorkspaceToolConfig()
                      : defaultHttpToolConfig(),
                  )
                }
                className={`${inputClass(isDark)} mt-2`}
              >
                <option value="workspace_file">读取工作区文件</option>
                <option value="http_request">HTTP 请求</option>
              </select>
            </label>
            {config.toolType === "workspace_file" ? (
              <>
                <label className="block">
                  <span className={sectionTitleClass}>相对路径</span>
                  <input
                    value={config.relativePath}
                    onChange={(event) =>
                      updateSelectedNodeConfig({
                        ...config,
                        relativePath: event.target.value,
                      })
                    }
                    className={`${inputClass(isDark)} mt-2`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={sectionTitleClass}>读取编码</span>
                    <select
                      value={config.encoding}
                      onChange={(event) =>
                        updateSelectedNodeConfig({
                          ...config,
                          encoding: event.target.value as WorkspaceFileToolConfig["encoding"],
                        })
                      }
                      className={`${inputClass(isDark)} mt-2`}
                    >
                      <option value="utf8">utf8</option>
                      <option value="base64">base64</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={sectionTitleClass}>失败策略</span>
                    <select
                      value={config.failureStrategy}
                      onChange={(event) =>
                        updateSelectedNodeConfig({
                          ...config,
                          failureStrategy: event.target.value as WorkspaceFileToolConfig["failureStrategy"],
                        })
                      }
                      className={`${inputClass(isDark)} mt-2`}
                    >
                      <option value="fail">失败即终止</option>
                      <option value="empty">返回空文本</option>
                    </select>
                  </label>
                </div>
              </>
            ) : null}
            {config.toolType === "http_request" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={sectionTitleClass}>请求方法</span>
                    <select
                      value={config.method}
                      onChange={(event) =>
                        updateSelectedNodeConfig({
                          ...config,
                          method: event.target.value as HttpRequestToolConfig["method"],
                        })
                      }
                      className={`${inputClass(isDark)} mt-2`}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={sectionTitleClass}>失败策略</span>
                    <select
                      value={config.failureStrategy}
                      onChange={(event) =>
                        updateSelectedNodeConfig({
                          ...config,
                          failureStrategy: event.target.value as HttpRequestToolConfig["failureStrategy"],
                        })
                      }
                      className={`${inputClass(isDark)} mt-2`}
                    >
                      <option value="fail">失败即终止</option>
                      <option value="empty">返回空文本</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className={sectionTitleClass}>请求地址</span>
                  <input
                    value={config.url}
                    onChange={(event) =>
                      updateSelectedNodeConfig({
                        ...config,
                        url: event.target.value,
                      })
                    }
                    className={`${inputClass(isDark)} mt-2`}
                  />
                </label>
                <label className="block">
                  <span className={sectionTitleClass}>请求头</span>
                  <textarea
                    rows={4}
                    value={config.headersText}
                    onChange={(event) =>
                      updateSelectedNodeConfig({
                        ...config,
                        headersText: event.target.value,
                      })
                    }
                    className={`${inputClass(isDark)} mt-2`}
                  />
                </label>
                <label className="block">
                  <span className={sectionTitleClass}>请求体模板</span>
                  <textarea
                    rows={4}
                    value={config.bodyTemplate}
                    onChange={(event) =>
                      updateSelectedNodeConfig({
                        ...config,
                        bodyTemplate: event.target.value,
                      })
                    }
                    className={`${inputClass(isDark)} mt-2`}
                  />
                </label>
              </>
            ) : null}
          </>
        ) : null}

        {isReviewNodeConfig(config) ? (
          <label className="block">
            <span className={sectionTitleClass}>审核说明</span>
            <textarea
              rows={4}
              value={config.instructions}
              onChange={(event) =>
                updateSelectedNodeConfig({
                  ...config,
                  instructions: event.target.value,
                })
              }
              className={`${inputClass(isDark)} mt-2`}
            />
          </label>
        ) : null}

        {isLoopNodeConfig(config) ? (
          <>
            <label className="block">
              <span className={sectionTitleClass}>列表变量名</span>
              <input
                value={config.itemsVariable}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    itemsVariable: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <label className="block">
              <span className={sectionTitleClass}>当前项变量名</span>
              <input
                value={config.itemVariableName}
                onChange={(event) =>
                  updateSelectedNodeConfig({
                    ...config,
                    itemVariableName: event.target.value,
                  })
                }
                className={`${inputClass(isDark)} mt-2`}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={sectionTitleClass}>项分支键</span>
                <input
                  value={config.itemBranchKey}
                  onChange={(event) =>
                    updateSelectedNodeConfig({
                      ...config,
                      itemBranchKey: event.target.value,
                    })
                  }
                  className={`${inputClass(isDark)} mt-2`}
                />
              </label>
              <label className="block">
                <span className={sectionTitleClass}>完成分支键</span>
                <input
                  value={config.doneBranchKey}
                  onChange={(event) =>
                    updateSelectedNodeConfig({
                      ...config,
                      doneBranchKey: event.target.value,
                    })
                  }
                  className={`${inputClass(isDark)} mt-2`}
                />
              </label>
            </div>
          </>
        ) : null}

        {isEndNodeConfig(config) ? (
          <label className="block">
            <span className={sectionTitleClass}>输出格式</span>
            <select
              value={config.outputFormat}
              onChange={(event) =>
                updateSelectedNodeConfig({
                  ...config,
                  outputFormat: event.target.value as typeof config.outputFormat,
                })
              }
              className={`${inputClass(isDark)} mt-2`}
            >
              <option value="markdown">Markdown</option>
              <option value="plain-text">纯文本</option>
            </select>
          </label>
        ) : null}
      </div>
    );
  };

  return (
    <main className="min-h-screen px-4 py-4 text-[var(--text-main)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1680px]">
        <section className="glass-panel rounded-[32px] p-6 sm:p-8">
          <div className="grid gap-6 xl:grid-cols-[1.5fr_360px]">
            <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(135deg,rgba(24,26,31,0.96),rgba(39,37,33,0.94))] p-6 shadow-[0_22px_52px_rgba(0,0,0,0.3)]">
              <div className="section-title">Workflow Control Room</div>
              <h1 className="display-title mt-3 text-5xl font-semibold tracking-[0.02em] sm:text-6xl">
                妙流 AI 编排台
              </h1>
              <p className="mt-6 max-w-4xl text-base leading-8 text-[var(--text-dim)]">
                这一版已经支持条件分支、变量上下文、工具节点、循环节点、审核恢复、模板导入导出和执行路径回放。
              </p>
            </div>
            <div className="rounded-[30px] border border-[var(--panel-line)] bg-[var(--panel-strong)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="section-title">运行环境</div>
                  <div className="mt-2 text-sm text-[var(--text-dim)]">
                    {appInfo ? `${appInfo.appName} / ${appInfo.platform}` : "正在读取应用信息"}
                  </div>
                </div>
                <button
                  type="button"
                  className={`rounded-full border px-4 py-2 text-sm transition ${consoleButtonClassMap[theme].workspace}`}
                  onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                >
                  切换到{isDark ? "浅色" : "暗色"}模式
                </button>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: "节点", value: String(nodes.length) },
                  { label: "审核", value: String(pendingReviews.length) },
                  { label: "连线", value: String(edges.length) },
                ].map((item) => (
                  <div key={item.label} className={`rounded-[20px] px-4 py-3 ${surfaceClass(isDark)}`}>
                    <div className="text-xs text-[var(--text-soft)]">{item.label}</div>
                    <div className="mt-2 text-3xl font-semibold">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-[20px] px-4 py-3 text-sm leading-7 text-[var(--text-dim)]">
                <div>Electron：{appInfo?.versions.electron ?? "加载中"}</div>
                <div>工作区：{workspacePath ?? "未选择"}</div>
                <div>默认模型：{modelSettings.defaultModel}</div>
              </div>
            </div>
          </div>

          <section className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_400px]">
            <aside className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
              <div className="section-title">节点工坊</div>
              <h2 className="mt-3 text-4xl font-semibold text-[var(--text-main)]">构建流程骨架</h2>
              <div className="mt-5 space-y-4">
                {kindButtonOrder.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => addNode(kind)}
                    className={`w-full rounded-[24px] border p-4 text-left shadow-[0_18px_42px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 ${kindCardClassName[theme][kind]}`}
                  >
                    <div className="text-xl font-semibold">{kindTextMap[kind]}</div>
                    <div className={`mt-2 text-sm leading-7 ${isDark ? "text-white/72" : "text-black/65"}`}>
                      {kind === "condition"
                        ? "根据表达式在真分支和假分支之间切换。"
                        : kind === "tool"
                          ? "执行文件读取或 HTTP 请求这类确定性操作。"
                          : kind === "loop"
                            ? "从列表变量中逐项取值，并推动后续节点循环执行。"
                            : "向当前流程图中追加一个新的可配置节点。"}
                    </div>
                  </button>
                ))}
              </div>

              <div className={`mt-6 rounded-[22px] p-4 ${surfaceClass(isDark)}`}>
                <div className={sectionTitleClass}>控制台</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].ping}`} onClick={() => void handlePing()}>测试握手</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].workspace}`} onClick={() => void handleOpenDirectory()}>选择工作区</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].import}`} onClick={() => void handleImportWorkflow()} disabled={isImportingWorkflow}>{isImportingWorkflow ? "导入中..." : "导入 JSON"}</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].export}`} onClick={() => void handleExportWorkflow("workflow")} disabled={isExportingWorkflow}>导出工作流</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].template}`} onClick={() => void handleExportWorkflow("template")} disabled={isExportingWorkflow}>导出模板</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].run}`} onClick={() => void handleRunWorkflow()} disabled={isRunning}>{isRunning ? "运行中..." : "运行流程"}</button>
                </div>
                <button type="button" className={`mt-3 w-full rounded-[18px] border px-4 py-3 text-sm font-semibold transition ${consoleButtonClassMap[theme].reset}`} onClick={() => void resetWorkflow()}>恢复默认草稿</button>
              </div>

              <div className={`mt-6 rounded-[22px] p-4 ${surfaceClass(isDark)}`}>
                <div className="flex items-center justify-between">
                  <div className={sectionTitleClass}>连线编辑</div>
                  <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].ping}`} onClick={addEdge}>新增连线</button>
                </div>
                <div className="mt-4 space-y-3">
                  {edges.map((edge) => (
                    <div key={edge.id} className={`rounded-[18px] p-3 ${surfaceClass(isDark)}`}>
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm">{edge.id}</strong>
                        <button type="button" className={`rounded-full border px-2.5 py-1 text-xs transition ${consoleButtonClassMap[theme].reset}`} onClick={() => removeEdge(edge.id)}>删除</button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <select value={edge.source} onChange={(event) => updateEdge(edge.id, { source: event.target.value })} className={inputClass(isDark)}>
                          {nodes.map((node) => <option key={`${edge.id}-source-${node.id}`} value={node.id}>{node.label} ({node.id})</option>)}
                        </select>
                        <select value={edge.target} onChange={(event) => updateEdge(edge.id, { target: event.target.value })} className={inputClass(isDark)}>
                          {nodes.map((node) => <option key={`${edge.id}-target-${node.id}`} value={node.id}>{node.label} ({node.id})</option>)}
                        </select>
                      </div>
                      <input value={edge.label ?? ""} onChange={(event) => updateEdge(edge.id, { label: event.target.value })} placeholder="显示标签" className={`${inputClass(isDark)} mt-3`} />
                      <input value={edge.branchKey ?? ""} onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value || undefined })} placeholder="分支键，例如 true / false / approved / item / done" className={`${inputClass(isDark)} mt-3`} />
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <section className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="section-title">编排舞台</div>
                  <h2 className="mt-3 text-4xl font-semibold text-[var(--text-main)]">工作流总览</h2>
                </div>
                <div className={`rounded-full px-4 py-2 text-sm ${surfaceClass(isDark)}`}>{nodes.length} 个节点 / {edges.length} 条连线</div>
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--text-dim)]">连线上的 branchKey 会直接参与运行时选择。执行后画布会高亮真实走过的路径。</p>
              <div className="mt-5">
                <WorkflowCanvasV2 nodes={nodes} edges={edges} selectedNodeId={selectedNodeId} theme={theme} activeEdgeIds={activeEdgeIds} onSelectNode={setSelectedNodeId} onUpdateNodePosition={updateNodePosition} />
              </div>
              <div className={`mt-6 rounded-[24px] p-4 ${surfaceClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className={sectionTitleClass}>编译预览</div>
                  <span className="text-xs text-[var(--text-soft)]">入口：{compiledSpec.entryNodeId ?? "未识别"}</span>
                </div>
                <pre className={`mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-[18px] p-4 text-xs leading-6 ${isDark ? "bg-[#0c1114] text-slate-300" : "bg-white/75 text-[#5e5246]"}`}>{jsonPreview(compiledSpec)}</pre>
              </div>
            </section>

            <aside className="space-y-6">
              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="section-title">节点观察席</div>
                <h2 className="mt-3 text-4xl font-semibold text-[var(--text-main)]">配置与执行</h2>
                {renderSelectedNodeConfig()}
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">当前上下文</div>
                  <span className={`rounded-full px-3 py-1 text-xs ${surfaceClass(isDark)}`}>变量预览</span>
                </div>
                <pre className={`mt-4 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-[18px] p-4 text-xs leading-6 ${isDark ? "bg-[#0c1114] text-slate-300" : "bg-white/75 text-[#5e5246]"}`}>{currentVariables ? jsonPreview(currentVariables) : "运行后或选中历史记录后，这里会展示变量快照。"}</pre>
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">执行路径回放</div>
                  <span className={`rounded-full px-3 py-1 text-xs ${surfaceClass(isDark)}`}>{currentPathTrace.length} 步路径</span>
                </div>
                <div className="mt-4 space-y-3">
                  {currentPathTrace.length > 0 ? currentPathTrace.map((entry, index) => (
                    <div key={`${entry.nodeId}-${index}`} className={`rounded-[18px] p-4 text-sm leading-6 ${surfaceClass(isDark)}`}>
                      <div className="flex items-center justify-between gap-3">
                        <strong>{entry.title}</strong>
                        <span className="text-xs text-[var(--text-soft)]">{entry.nodeId}</span>
                      </div>
                      <div className="mt-2 text-[var(--text-dim)]">{entry.summary}</div>
                      <div className="mt-2 text-xs text-[var(--text-soft)]">分支键：{entry.chosenExit?.branchKey ?? "默认出口"} · 下一节点：{entry.chosenExit?.target ?? "流程结束或等待人工处理"}</div>
                    </div>
                  )) : <p className="text-sm leading-7 text-[var(--text-dim)]">运行后这里会显示每一步真实命中的路径，包括分支键和下一节点。</p>}
                </div>
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">执行结果</div>
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${consoleButtonClassMap[theme].run}`}
                    onClick={() => void handleRunWorkflow()}
                    disabled={isRunning}
                  >
                    {isRunning ? "运行中..." : "重新运行"}
                  </button>
                </div>
                {runResult ? (
                  <div className="mt-4 space-y-3">
                    <div className={`rounded-[20px] px-4 py-3 text-sm leading-6 ${surfaceClass(isDark)}`}>
                      <div className="flex items-center gap-2">
                        <span>执行状态</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusBadgeClassMap[runResult.status]}`}>
                          {statusTextMap[runResult.status]}
                        </span>
                      </div>
                      <div>开始时间：{runResult.startedAt}</div>
                      <div>结束时间：{runResult.finishedAt}</div>
                      <div className="mt-2">{runResult.summary}</div>
                    </div>
                    {runResult.steps.map((step, index) => (
                      <div key={`${step.nodeId}-${index}`} className={`rounded-[20px] px-4 py-3 text-sm leading-6 ${surfaceClass(isDark)}`}>
                        <div className="flex items-center justify-between gap-3">
                          <strong className={isDark ? "text-white" : "text-[#2f241b]"}>{step.title}</strong>
                          <span className="text-xs text-[var(--text-soft)]">{step.nodeId}</span>
                        </div>
                        <div className="mt-2 text-[var(--text-dim)]">{step.summary}</div>
                        {step.output ? (
                          <pre className={`mt-3 whitespace-pre-wrap break-all rounded-[18px] px-3 py-2 text-xs leading-6 ${isDark ? "bg-[#0a0f12] text-[#c6bcad]" : "bg-white/75 text-[#5a4d41]"}`}>{step.output}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-[var(--text-dim)]">运行后这里会展示状态、摘要和每一步输出。</p>
                )}
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">待审核任务</div>
                  <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].ping}`} onClick={() => void refreshPendingReviews()}>
                    刷新列表
                  </button>
                </div>
                {pendingReviews.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {pendingReviews.map((review) => (
                      <div key={review.sessionId} className={`rounded-[20px] px-4 py-3 text-sm leading-6 ${surfaceClass(isDark)}`}>
                        <div className="flex items-center justify-between gap-3">
                          <strong className={isDark ? "text-white" : "text-[#2f241b]"}>{review.title}</strong>
                          <span className="text-xs text-[var(--text-soft)]">{review.sessionId}</span>
                        </div>
                        <div className="mt-2 text-[var(--text-dim)]">审核说明：{review.instructions || "未填写审核说明"}</div>
                        <div className="mt-2 text-[var(--text-dim)]">工作区：{review.workspacePath ?? "未选择"}</div>
                        <label className="mt-3 block">
                          <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">审核备注</span>
                          <textarea
                            rows={3}
                            value={reviewNotes[review.sessionId] ?? ""}
                            onChange={(event) =>
                              setReviewNotes((current) => ({
                                ...current,
                                [review.sessionId]: event.target.value,
                              }))
                            }
                            className={inputClass(isDark)}
                          />
                        </label>
                        <pre className={`mt-3 whitespace-pre-wrap break-all rounded-[18px] px-3 py-2 text-xs leading-6 ${isDark ? "bg-[#0a0f12] text-[#c6bcad]" : "bg-white/75 text-[#5a4d41]"}`}>{review.latestOutput || "当前还没有上一节点输出。"}</pre>
                        <div className="mt-3 flex gap-3">
                          <button type="button" className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100 transition hover:border-emerald-200/45 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmittingReview} onClick={() => void handleReviewDecision(review.sessionId, "approved")}>审核通过并继续</button>
                          <button type="button" className="rounded-full border border-rose-300/25 bg-rose-400/10 px-3 py-1 text-xs text-rose-100 transition hover:border-rose-200/45 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmittingReview} onClick={() => void handleReviewDecision(review.sessionId, "rejected")}>驳回并终止</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-[var(--text-dim)]">当前没有待处理审核任务。</p>
                )}
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">运行历史</div>
                  <div className="flex gap-2">
                    <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].ping}`} onClick={() => void refreshWorkflowHistory()}>刷新</button>
                    <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].reset}`} onClick={() => void handleClearWorkflowHistory()}>清空</button>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {workflowHistory.length > 0 ? workflowHistory.map((item) => {
                    const isSelected = selectedHistoryItem?.id === item.id;
                    return (
                      <button key={item.id} type="button" onClick={() => setSelectedHistoryId(item.id)} className={`w-full rounded-[20px] border px-4 py-3 text-left transition ${isSelected ? isDark ? "border-[#d8a35d]/45 bg-[#d8a35d]/10" : "border-[#a67027]/35 bg-[#a67027]/8" : surfaceClass(isDark)}`}>
                        <div className="flex items-center justify-between gap-3">
                          <strong className={isDark ? "text-white" : "text-[#2f241b]"}>{item.source === "run" ? "直接运行" : "审核处理"}</strong>
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusBadgeClassMap[item.status]}`}>{statusTextMap[item.status]}</span>
                        </div>
                        <div className="mt-2 text-sm text-[var(--text-dim)]">{item.summary}</div>
                        <div className="mt-2 text-xs text-[var(--text-soft)]">{item.finishedAt} · {item.stepCount} 步</div>
                      </button>
                    );
                  }) : <p className="text-sm leading-7 text-[var(--text-dim)]">还没有运行历史。</p>}
                </div>
                {selectedHistoryItem ? (
                  <div className={`mt-4 rounded-[22px] p-4 ${surfaceClass(isDark)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="section-title">历史详情</div>
                      <div className="flex gap-2">
                        <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].workspace}`} onClick={() => void handleExportWorkflowHistory("markdown")}>导出 Markdown</button>
                        <button type="button" className={`rounded-full border px-3 py-1 text-xs transition ${consoleButtonClassMap[theme].export}`} onClick={() => void handleExportWorkflowHistory("json")}>导出 JSON</button>
                      </div>
                    </div>
                    <pre className={`mt-3 max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded-[18px] p-4 text-xs leading-6 ${isDark ? "bg-[#0c1114] text-slate-300" : "bg-white/75 text-[#5e5246]"}`}>{jsonPreview(selectedHistoryItem.variablesSnapshot)}</pre>
                  </div>
                ) : null}
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="section-title">模型服务</div>
                  <span className={`rounded-full px-3 py-1 text-xs ${surfaceClass(isDark)}`}>当前：{modelSettings.defaultModel}</span>
                </div>
                <div className="mt-4 space-y-4">
                  <input value={modelSettings.serviceUrl} onChange={(event) => setModelSettings((current) => ({ ...current, serviceUrl: event.target.value }))} className={inputClass(isDark)} />
                  <input value={modelSettings.defaultModel} onChange={(event) => setModelSettings((current) => ({ ...current, defaultModel: event.target.value }))} className={inputClass(isDark)} />
                  <input type="number" min={1000} step={1000} value={modelSettings.requestTimeoutMs} onChange={(event) => setModelSettings((current) => ({ ...current, requestTimeoutMs: Number(event.target.value) || 1000 }))} className={inputClass(isDark)} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${consoleButtonClassMap[theme].workspace}`} onClick={() => void handleSaveModelSettings()} disabled={isSavingModelSettings}>{isSavingModelSettings ? "保存中..." : "保存模型配置"}</button>
                  <button type="button" className={`rounded-[18px] border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${consoleButtonClassMap[theme].ping}`} onClick={() => void handleTestModelConnection()} disabled={isTestingModelConnection}>{isTestingModelConnection ? "测试中..." : "测试模型连接"}</button>
                </div>
              </div>

              <div className={`rounded-[28px] p-5 ${panelClass(isDark)}`}>
                <div className="section-title">运行日志</div>
                <div className="mt-4 space-y-2 text-sm leading-6 text-[var(--text-dim)]">
                  {logs.map((entry, index) => (
                    <div key={`${entry}-${index}`} className={`rounded-[16px] px-3 py-2 ${surfaceClass(isDark)}`}>{entry}</div>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        </section>
      </section>
    </main>
  );
};
