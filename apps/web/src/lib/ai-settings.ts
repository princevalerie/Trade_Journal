export const AI_PROVIDERS = ["openrouter", "gemini", "openai", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  openrouter: "openrouter/free",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4.1-mini",
  anthropic: "claude-opus-5",
};

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  openrouter: "OpenRouter (Free)",
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
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
  value === "openrouter" || value === "anthropic" || value === "openai" || value === "gemini";
