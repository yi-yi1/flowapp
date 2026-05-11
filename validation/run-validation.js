const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const fixturesDir = path.join(__dirname, "fixtures");
const resultsDir = path.join(__dirname, "results");

const defaultModelSettings = {
  serviceUrl:
    process.env.WORKFLOW_MODEL_URL ||
    "http://10.16.7.142:11434/v1/chat/completions",
  defaultModel: process.env.WORKFLOW_MODEL_NAME || "qwen3.5-9b",
  requestTimeoutMs: 45000,
};

const checks = [];

const addCheck = (name, passed, details) => {
  checks.push({
    name,
    passed,
    details,
    checkedAt: new Date().toISOString(),
  });
};

const validateFixtureShape = (fixture) => {
  const nodeIds = new Set(fixture.nodes.map((node) => node.id));
  const nodeMap = new Map(fixture.nodes.map((node) => [node.id, node]));
  const invalidEdge = fixture.edges.find(
    (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target),
  );

  if (invalidEdge) {
    throw new Error(`发现无效连线 ${invalidEdge.id}，其 source 或 target 不存在。`);
  }

  const startNodes = fixture.nodes.filter((node) => node.kind === "start");
  const endNodes = fixture.nodes.filter((node) => node.kind === "end");
  const reviewNodes = fixture.nodes.filter((node) => node.kind === "review");
  const conditionNodes = fixture.nodes.filter((node) => node.kind === "condition");
  const toolNodes = fixture.nodes.filter((node) => node.kind === "tool");
  const loopNodes = fixture.nodes.filter((node) => node.kind === "loop");
  const structuredLlmNodes = fixture.nodes.filter(
    (node) => node.kind === "llm" && node.config?.outputMode === "structured",
  );

  const branchlessEdge = fixture.edges.find((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    return (
      (sourceNode?.kind === "condition" || sourceNode?.kind === "loop") &&
      !edge.branchKey
    );
  });

  if (startNodes.length !== 1) {
    throw new Error(`期望恰好 1 个开始节点，实际为 ${startNodes.length} 个。`);
  }

  if (endNodes.length < 1) {
    throw new Error("至少需要 1 个结束节点。");
  }

  if (branchlessEdge) {
    throw new Error(`连线 ${branchlessEdge.id} 缺少 branchKey，无法表达分支路径。`);
  }

  if (
    fixture.expectations &&
    typeof fixture.expectations.reviewNodeCount === "number" &&
    fixture.expectations.reviewNodeCount !== reviewNodes.length
  ) {
    throw new Error(
      `审核节点数量不符合预期，期望 ${fixture.expectations.reviewNodeCount}，实际 ${reviewNodes.length}。`,
    );
  }

  if (
    fixture.expectations &&
    typeof fixture.expectations.conditionNodeCount === "number" &&
    fixture.expectations.conditionNodeCount !== conditionNodes.length
  ) {
    throw new Error(
      `条件节点数量不符合预期，期望 ${fixture.expectations.conditionNodeCount}，实际 ${conditionNodes.length}。`,
    );
  }

  if (
    fixture.expectations &&
    typeof fixture.expectations.toolNodeCount === "number" &&
    fixture.expectations.toolNodeCount !== toolNodes.length
  ) {
    throw new Error(
      `工具节点数量不符合预期，期望 ${fixture.expectations.toolNodeCount}，实际 ${toolNodes.length}。`,
    );
  }

  if (
    fixture.expectations &&
    typeof fixture.expectations.loopNodeCount === "number" &&
    fixture.expectations.loopNodeCount !== loopNodes.length
  ) {
    throw new Error(
      `循环节点数量不符合预期，期望 ${fixture.expectations.loopNodeCount}，实际 ${loopNodes.length}。`,
    );
  }

  if (
    fixture.expectations &&
    typeof fixture.expectations.structuredLlmCount === "number" &&
    fixture.expectations.structuredLlmCount !== structuredLlmNodes.length
  ) {
    throw new Error(
      `结构化模型节点数量不符合预期，期望 ${fixture.expectations.structuredLlmCount}，实际 ${structuredLlmNodes.length}。`,
    );
  }
};

const validateFixtures = async () => {
  const fixtureNames = [
    "workflow-graph.json",
    "workflow-loop.json",
    "editor-draft-sample-v2.json",
    "pending-review-sample-v2.json",
    "workflow-document-sample-v2.json",
  ];

  for (const fixtureName of fixtureNames) {
    const fixturePath = path.join(fixturesDir, fixtureName);
    const content = await fs.readFile(fixturePath, "utf8");
    const fixture = JSON.parse(content);

    if (fixtureName === "workflow-document-sample-v2.json") {
      if (fixture.kind !== "workflow" && fixture.kind !== "template") {
        throw new Error("工作流文档样例缺少 kind 字段。");
      }

      if (!fixture.draft || !Array.isArray(fixture.draft.nodes) || !Array.isArray(fixture.draft.edges)) {
        throw new Error("工作流文档样例缺少合法的 draft。");
      }

      addCheck(
        `工作流文档样例校验：${fixtureName}`,
        true,
        `文档类型 ${fixture.kind}，节点 ${fixture.draft.nodes.length} 个。`,
      );
      continue;
    }

    if (fixtureName.startsWith("workflow-")) {
      validateFixtureShape(fixture);
      addCheck(
        `工作流样例校验：${fixtureName}`,
        true,
        `节点 ${fixture.nodes.length} 个，连线 ${fixture.edges.length} 条。`,
      );
      continue;
    }

    if (fixtureName === "editor-draft-sample-v2.json") {
      if (!Array.isArray(fixture.nodes) || !Array.isArray(fixture.edges)) {
        throw new Error("编辑器草稿样例缺少 nodes 或 edges 数组。");
      }

      addCheck(
        `草稿样例校验：${fixtureName}`,
        true,
        `已检查 selectedNodeId=${fixture.selectedNodeId} 与 theme=${fixture.theme}。`,
      );
      continue;
    }

    if (fixtureName === "pending-review-sample-v2.json") {
      if (
        !fixture.sessionId ||
        !Array.isArray(fixture.steps) ||
        typeof fixture.variablesSnapshot !== "object" ||
        !Array.isArray(fixture.pathTrace)
      ) {
        throw new Error("待审核样例缺少 sessionId、steps、variablesSnapshot 或 pathTrace。");
      }

      addCheck(
        `审核样例校验：${fixtureName}`,
        true,
        `已检查 sessionId=${fixture.sessionId}，步骤数 ${fixture.steps.length}。`,
      );
    }
  }
};

const validateToolingStatus = async () => {
  const toolingStatusPath = path.join(resultsDir, "tooling-status.json");

  try {
    const content = await fs.readFile(toolingStatusPath, "utf8");
    const tooling = JSON.parse(content);

    addCheck(
      "TypeScript 类型检查",
      Boolean(tooling.typescript?.passed),
      tooling.typescript?.details || "未提供 TypeScript 验证结果。",
    );
    addCheck(
      "ESLint 静态检查",
      Boolean(tooling.eslint?.passed),
      tooling.eslint?.details || "未提供 ESLint 验证结果。",
    );
  } catch (error) {
    const details =
      error instanceof Error
        ? `未读取到 validation/results/tooling-status.json：${error.message}`
        : "未读取到 validation/results/tooling-status.json。";

    addCheck("TypeScript 类型检查", false, details);
    addCheck("ESLint 静态检查", false, details);
  }
};

const testRemoteModel = async () => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    defaultModelSettings.requestTimeoutMs,
  );

  try {
    const response = await fetch(defaultModelSettings.serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: defaultModelSettings.defaultModel,
        messages: [
          {
            role: "system",
            content: "你是工作流验证助手。请只回复一句中文短句。",
          },
          {
            role: "user",
            content: "请回复：验证通过。",
          },
        ],
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      addCheck(
        "远程模型连通性",
        false,
        `HTTP ${response.status}，响应：${body || "空响应"}`,
      );
      return;
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content?.trim?.() || "";
    const content = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    addCheck(
      "远程模型连通性",
      Boolean(content),
      content ? `服务已连通，模型返回：${content.slice(0, 120)}` : "模型未返回有效内容。",
    );
  } catch (error) {
    addCheck(
      "远程模型连通性",
      false,
      error instanceof Error ? error.message : "未知错误",
    );
  } finally {
    clearTimeout(timer);
  }
};

const validatePackagedArtifacts = async () => {
  const packagedDir = path.join(rootDir, "out", "flowapp-win32-x64");
  const packagedExe = path.join(packagedDir, "flowapp.exe");
  const builtMain = path.join(rootDir, ".vite", "build-main", "main.js");
  const builtPreload = path.join(rootDir, ".vite", "build-preload", "preload.js");

  try {
    const [exeStat, mainStat, preloadStat] = await Promise.all([
      fs.stat(packagedExe),
      fs.stat(builtMain),
      fs.stat(builtPreload),
    ]);

    addCheck(
      "打包产物校验",
      true,
      [
        `已发现可执行文件：${path.relative(rootDir, packagedExe)}`,
        `EXE 大小：${exeStat.size} 字节`,
        `主进程构建：${path.relative(rootDir, builtMain)} (${mainStat.size} 字节)`,
        `Preload 构建：${path.relative(rootDir, builtPreload)} (${preloadStat.size} 字节)`,
      ].join("；"),
    );
  } catch (error) {
    addCheck(
      "打包产物校验",
      false,
      error instanceof Error
        ? `未找到完整打包产物：${error.message}`
        : "未找到完整打包产物。",
    );
  }
};

const writeReports = async () => {
  await fs.mkdir(resultsDir, { recursive: true });

  const passedCount = checks.filter((item) => item.passed).length;
  const failedChecks = checks.filter((item) => !item.passed);
  const summary = {
    checkedAt: new Date().toISOString(),
    total: checks.length,
    passed: passedCount,
    failed: failedChecks.length,
    checks,
  };

  const markdown = [
    "# AI 工作流应用验证报告",
    "",
    `- 验证时间：${summary.checkedAt}`,
    `- 总检查项：${summary.total}`,
    `- 通过：${summary.passed}`,
    `- 未通过：${summary.failed}`,
    "",
    "## 检查结果",
    "",
    ...checks.map(
      (item) =>
        `- [${item.passed ? "x" : " "}] ${item.name}：${item.details.replace(/\r?\n/g, " ")}`,
    ),
  ].join("\n");

  await fs.writeFile(
    path.join(resultsDir, "latest-validation-report.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(resultsDir, "latest-validation-report.md"),
    markdown,
    "utf8",
  );
};

const main = async () => {
  await validateFixtures();
  await validateToolingStatus();
  await testRemoteModel();
  await validatePackagedArtifacts();
  await writeReports();

  const failedChecks = checks.filter((item) => !item.passed);
  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
