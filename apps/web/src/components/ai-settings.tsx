"use client";

import { useEffect, useRef, useState } from "react";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";

export function AiSettings() {
  const { data, error, loading, refresh } = useApi<AiSettingsPayload>("/api/settings");
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState(AI_DEFAULT_MODELS.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [isCustomModel, setIsCustomModel] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const fetchAvailableModels = async (targetProvider: AiProvider = provider, keyOverride = apiKey) => {
    const activeKey = keyOverride.trim() || (apiKeyInputRef.current?.value || "").trim();
    const hasKey = Boolean(activeKey || data?.aiConnections[targetProvider]?.configured);
    if (!hasKey) {
      setDetectedModels([]);
      setDetectError("");
      return;
    }
    setDetectingModels(true);
    setDetectError("");
    try {
      const params = new URLSearchParams({ provider: targetProvider });
      if (activeKey) params.set("apiKey", activeKey);
      const res = await fetch(`/api/ai/models?${params.toString()}`);
      if (res.ok) {
        const payload = (await res.json()) as { models?: string[]; error?: string };
        if (payload.error) {
          setDetectedModels([]);
          setDetectError(payload.error);
        } else if (Array.isArray(payload.models) && payload.models.length > 0) {
          const list = payload.models;
          setDetectedModels(list);
          setDetectError("");
          setIsCustomModel(false);
          const first = list[0] ?? "";
          if (first) {
            setModel((prev) => (list.includes(prev) ? prev : first));
          }
        } else {
          setDetectedModels([]);
          setDetectError("Tidak ada model yang ditemukan untuk akun ini.");
        }
      } else {
        setDetectedModels([]);
        setDetectError("Gagal menghubungi server untuk mendeteksi model.");
      }
    } catch (err) {
      setDetectedModels([]);
      setDetectError(err instanceof Error ? err.message : "Gagal mendeteksi model.");
    } finally {
      setDetectingModels(false);
    }
  };

  useEffect(() => {
    if (!data) return;
    setProvider(data.aiProvider);
    setModel(data.aiModel);
    if (data.aiConnections[data.aiProvider]?.configured) {
      void fetchAvailableModels(data.aiProvider, "");
    } else {
      setDetectedModels([]);
      setDetectError("");
    }
  }, [data]);

  const connection = data?.aiConnections[provider];
  const environment = connection?.source === "environment";
  const name = AI_PROVIDER_NAMES[provider];
  const disabled = busy || loading || !data;

  const save = async (remove = false) => {
    setBusy(true);
    setFailure("");
    setSaved("");
    try {
      const payload: Record<string, unknown> = {
        aiProvider: provider,
        aiModel: model.trim() || AI_DEFAULT_MODELS[provider],
      };
      if (remove) {
        payload[`${provider}Key`] = null;
      } else if (apiKey.trim()) {
        payload[`${provider}Key`] = apiKey.trim();
      }
      await postJson("/api/settings", payload, "PATCH");
      setApiKey("");
      setSaved(remove ? `${name} key removed.` : `${name} settings saved.`);
      refresh();
      if (!remove) {
        void fetchAvailableModels(provider, "");
      } else {
        setDetectedModels([]);
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Couldn’t save AI settings.");
    } finally {
      setBusy(false);
    }
  };

  const modelOptions = Array.from(
    new Set([
      ...(model && !model.startsWith("__custom") ? [model] : []),
      ...detectedModels,
    ]),
  );

  const isConfigured = Boolean(connection?.configured);

  return (
    <Card id="ai-settings" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>AI (bring your own key)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Use Google Gemini, Anthropic, or OpenAI for recaps, trade critiques, and “ask your journal”. Your key is
          encrypted at rest. AI requests go from your server directly to the provider you select.
        </p>
        {data && (
          <p className="text-xs text-muted-foreground">
            Active provider: {AI_PROVIDER_NAMES[data.aiProvider]} ·{" "}
            {data.aiConfigured ? "Key configured" : "Not configured"}
          </p>
        )}
        <div className={`grid gap-4 ${isConfigured ? "sm:grid-cols-2" : ""}`}>
          <div className="space-y-1.5">
            <Label htmlFor="ai-provider">Provider</Label>
            <OptionSelect
              id="ai-provider"
              value={provider}
              disabled={disabled}
              onValueChange={(value) => {
                const next = value as AiProvider;
                setProvider(next);
                setModel(data?.aiConnections[next]?.model ?? AI_DEFAULT_MODELS[next]);
                setApiKey("");
                setSaved("");
                setFailure("");
                setDetectedModels([]);
                setDetectError("");
                setIsCustomModel(false);
                if (data?.aiConnections[next]?.configured) {
                  void fetchAvailableModels(next, "");
                }
              }}
            >
              {AI_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDER_NAMES[id]}
                </option>
              ))}
            </OptionSelect>
          </div>

          {isConfigured && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-model">Model ID</Label>
                <div className="flex items-center gap-2">
                  {detectedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCustomModel((prev) => !prev)}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      {isCustomModel ? "Pilih Dropdown" : "Ketik Manual"}
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-primary hover:text-primary/80 font-medium"
                    disabled={disabled || detectingModels}
                    onClick={() => void fetchAvailableModels(provider, apiKey)}
                  >
                    {detectingModels ? "Mendeteksi..." : "⚡ Refresh Model"}
                  </Button>
                </div>
              </div>

              {detectingModels && detectedModels.length === 0 ? (
                <div className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background/50 px-3 py-2 text-sm text-muted-foreground animate-pulse">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
                    Mengambil daftar model dari {name}...
                  </span>
                </div>
              ) : detectedModels.length > 0 && !isCustomModel ? (
                <OptionSelect
                  id="ai-model"
                  value={model}
                  disabled={disabled}
                  onValueChange={(val) => {
                    if (val === "__custom__") {
                      setIsCustomModel(true);
                    } else {
                      setModel(val);
                      setSaved("");
                    }
                  }}
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="__custom__">Manual / Custom Model ID...</option>
                </OptionSelect>
              ) : (
                <Input
                  id="ai-model"
                  value={model}
                  disabled={disabled}
                  placeholder={AI_DEFAULT_MODELS[provider]}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setSaved("");
                  }}
                />
              )}

              {detectError && (
                <p className="text-[11px] text-amber-500/90 pt-0.5">{detectError}</p>
              )}

              {detectedModels.length > 0 && !isCustomModel && (
                <p className="text-[11px] text-profit flex items-center gap-1 pt-0.5">
                  <span>✓</span> {detectedModels.length} model aktif tersedia di akun {name}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Use a text model available to your provider account. Each provider keeps its own model and
          key.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="ai-api-key">{name} API key</Label>
          <Input
            id="ai-api-key"
            ref={apiKeyInputRef}
            type="password"
            value={apiKey}
            disabled={disabled || environment}
            onChange={(event) => {
              setApiKey(event.target.value);
              setSaved("");
            }}
            placeholder={
              connection?.configured
                ? "Key configured"
                : provider === "gemini"
                  ? "AIzaSy…"
                  : provider === "anthropic"
                    ? "sk-ant-…"
                    : "sk-…"
            }
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {environment
              ? `Using ${
                  provider === "gemini"
                    ? "GEMINI_API_KEY"
                    : provider === "openai"
                      ? "OPENAI_API_KEY"
                      : "ANTHROPIC_API_KEY"
                } from the server environment. Change or remove that variable on the server to update the key.`
              : connection?.configured
                ? "Key sudah tersimpan. Biarkan kosong jika tidak ingin mengubah key, atau masukkan key baru untuk mengganti."
                : "Masukkan API key Anda lalu klik Save untuk memuat daftar model yang tersedia."}
          </p>
        </div>
        {(error || failure) && (
          <p role="alert" className="text-xs text-destructive">
            {failure || error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs text-profit">
            {saved}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            disabled={disabled || (!isConfigured && !apiKey.trim()) || (isConfigured && !model.trim())}
            onClick={() => save()}
          >
            {busy ? "Menyimpan…" : isConfigured ? "Save AI settings" : "Save AI settings"}
          </Button>
          {connection?.source === "saved" && (
            <Button variant="outline" disabled={disabled} onClick={() => save(true)}>
              Remove {name} key
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
