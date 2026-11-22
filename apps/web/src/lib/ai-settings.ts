export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
};

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

export interface AiConnection {
  configured: boolean;
  source: "environment" | "saved" | null;
  model: string;
}

export interface AiSettingsPayload {
  aiProvider: AiProvider;
  aiConfigured: boolean;
  aiModel: string;
  aiConnections: Record<AiProvider, AiConnection>;
}

export const isAiProvider = (value: unknown): value is AiProvider =>
  value === "anthropic" || value === "openai" || value === "gemini";
