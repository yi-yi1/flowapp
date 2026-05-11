import type { WorkflowModelSettings } from "../../shared/model-settings";
import { defaultWorkflowModelSettings } from "../../shared/model-settings";

type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RemoteGenerateRequest = {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
};

type ChatCompletionChoice = {
  message?: {
    content?: string;
  };
};

type ChatCompletionResponse = {
  model?: string;
  choices?: ChatCompletionChoice[];
};

export const getModelServiceUrl = (): string => activeSettings.serviceUrl;

export const getDefaultRemoteModel = (): string => activeSettings.defaultModel;

export const getModelServiceSettings = (): WorkflowModelSettings => ({
  ...activeSettings,
});

let activeSettings: WorkflowModelSettings = {
  ...defaultWorkflowModelSettings,
  serviceUrl:
    process.env.WORKFLOW_MODEL_URL?.trim() ||
    defaultWorkflowModelSettings.serviceUrl,
  defaultModel:
    process.env.WORKFLOW_MODEL_NAME?.trim() ||
    defaultWorkflowModelSettings.defaultModel,
};

export const hydrateModelServiceSettings = (
  settings: Partial<WorkflowModelSettings>,
): WorkflowModelSettings => {
  activeSettings = {
    ...activeSettings,
    ...settings,
  };

  return getModelServiceSettings();
};

const stripThinkTags = (content: string): string =>
  content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

const withTimeout = async <T>(
  input: string,
  init: RequestInit,
  timeoutMs = activeSettings.requestTimeoutMs,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `模型服务请求失败，状态码 ${response.status}，响应内容：${body || "空"}`,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接模型服务超时，请确认服务地址和模型服务状态。");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("调用模型服务时发生未知错误。");
  } finally {
    clearTimeout(timer);
  }
};

export const generateWithRemoteModel = async (
  payload: RemoteGenerateRequest,
): Promise<{
  content: string;
  rawContent: string;
  model: string;
}> => {
  const messages: ChatCompletionMessage[] = [];

  if (payload.system?.trim()) {
    messages.push({
      role: "system",
      content: payload.system.trim(),
    });
  }

  messages.push({
    role: "user",
    content: payload.prompt,
  });

  const response = await withTimeout<ChatCompletionResponse>(
    getModelServiceUrl(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        messages,
        temperature: payload.temperature ?? 0,
        stream: false,
      }),
    },
  );

  const rawContent = response.choices?.[0]?.message?.content?.trim() ?? "";
  const content = stripThinkTags(rawContent);

  if (!content) {
    throw new Error("模型服务未返回可用内容，请检查提示词或服务端日志。");
  }

  return {
    content,
    rawContent,
    model: response.model || payload.model,
  };
};

export const testModelServiceConnection = async (
  settings?: Partial<WorkflowModelSettings>,
): Promise<{
  ok: true;
  model: string;
  preview: string;
}> => {
  const previousSettings = getModelServiceSettings();

  try {
    if (settings) {
      hydrateModelServiceSettings(settings);
    }

    const response = await generateWithRemoteModel({
      model: getDefaultRemoteModel(),
      system: "你是工作流模型连通性探针。请只用中文回复一句简短确认语。",
      prompt: "请回复：连接成功。",
      temperature: 0,
    });

    return {
      ok: true,
      model: response.model,
      preview: response.content.slice(0, 120),
    };
  } finally {
    if (settings) {
      hydrateModelServiceSettings(previousSettings);
    }
  }
};
