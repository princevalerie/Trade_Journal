import { getAiKey } from "@/server/settings";
import { isAiProvider, type AiProvider } from "@/lib/ai-settings";
import { handler, ok } from "@/server/api";

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const providerParam = url.searchParams.get("provider");
  const provider: AiProvider = isAiProvider(providerParam) ? providerParam : "gemini";
  const userApiKey = url.searchParams.get("apiKey")?.trim() || (await getAiKey(provider));

  if (!userApiKey) {
    return ok({
      models: [],
      error: "Masukkan API key terlebih dahulu untuk mendeteksi model.",
    });
  }

  try {
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(userApiKey)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return ok({
          models: [],
          error: errData?.error?.message || `Gagal mengambil model (${res.status} ${res.statusText}).`,
        });
      }
      const data = (await res.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
      };
      const detected = (data.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((m) => m.startsWith("gemini-"))
        .sort((a, b) => {
          // Priority sort: 2.5 > 2.0 > 1.5
          const aVer = a.match(/\d+(\.\d+)?/)?.[0] || "0";
          const bVer = b.match(/\d+(\.\d+)?/)?.[0] || "0";
          return parseFloat(bVer) - parseFloat(aVer);
        });

      return ok({
        models: Array.from(new Set(detected)),
        count: detected.length,
      });
    } else if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${userApiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return ok({
          models: [],
          error: errData?.error?.message || `Gagal mengambil model (${res.status} ${res.statusText}).`,
        });
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      const detected = (data.data || [])
        .map((m) => m.id)
        .filter((id) => /^(gpt-|o1|o3)/.test(id) && !id.includes("realtime") && !id.includes("audio"))
        .sort();

      return ok({
        models: detected,
        count: detected.length,
      });
    } else if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": userApiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return ok({
          models: [],
          error: errData?.error?.message || `Gagal mengambil model (${res.status} ${res.statusText}).`,
        });
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      const detected = (data.data || []).map((m) => m.id).sort();

      return ok({
        models: detected,
        count: detected.length,
      });
    }
  } catch (err) {
    return ok({
      models: [],
      error: err instanceof Error ? err.message : "Gagal menghubungi server API.",
    });
  }

  return ok({
    models: [],
    error: "Provider tidak dikenali.",
  });
});
