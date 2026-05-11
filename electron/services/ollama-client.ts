const OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";

type OllamaTagsResponse = {
  models?: Array<{
    name: string;
  }>;
};

type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
};

type OllamaGenerateResponse = {
  response?: string;
  done?: boolean;
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

const withTimeout = async <T>(
  input: string,
  init: RequestInit,
  timeoutMs = 12_000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama 请求失败，状态码 ${response.status}。`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接 Ollama 超时，请确认本地服务是否已经启动。");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("连接 Ollama 时发生未知错误。");
  } finally {
    clearTimeout(timer);
  }
};

export const listLocalModels = async (): Promise<string[]> => {
  const result = await withTimeout<OllamaTagsResponse>(
    `${OLLAMA_BASE_URL}/tags`,
    {
      method: "GET",
    },
    6_000,
  );

  return result.models?.map((model) => model.name) ?? [];
};

export const assertModelAvailable = async (model: string): Promise<void> => {
  let modelNames: string[];

  try {
    modelNames = await listLocalModels();
  } catch {
    throw new Error(
      "未检测到本地 Ollama 服务，请先安装并启动 Ollama，然后执行 `ollama run qwen2.5:0.5b` 等命令拉取模型。",
    );
  }

  if (modelNames.length === 0) {
    throw new Error(
      "Ollama 已启动，但当前没有可用模型，请先执行 `ollama run qwen2.5:0.5b` 下载模型。",
    );
  }

  if (!modelNames.includes(model)) {
    throw new Error(
      `本地未找到模型 ${model}。当前可用模型：${modelNames.join("、")}。`,
    );
  }
};

export const generateWithOllama = async (
  payload: OllamaGenerateRequest,
): Promise<OllamaGenerateResponse> => {
  await assertModelAvailable(payload.model);

  return withTimeout<OllamaGenerateResponse>(`${OLLAMA_BASE_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      stream: false,
    }),
  });
};
