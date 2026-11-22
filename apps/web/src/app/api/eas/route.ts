import { inArray } from "drizzle-orm";
import { db, trades } from "@/db";
import { handler, ok } from "@/server/api";

const list = (v: string | null | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const accountsParam = url.searchParams.get("accounts");
  const accountList = list(accountsParam);

  const query = db
    .select({
      tagsJson: trades.tagsJson,
      notes: trades.notes,
    })
    .from(trades);

  const allTrades = accountList.length > 0
    ? query.where(inArray(trades.accountId, accountList)).all()
    : query.all();

  const STANDARD_TAGS = new Set([
    "manual",
    "manual exit",
    "ea exit",
    "hit sl",
    "hit tp",
    "stop out",
    "break even",
    "market order",
    "limit order",
    "stop order",
    "forex",
    "cfd",
    "crypto",
    "equity",
    "futures",
    "ea",
  ]);

  interface EaGroup {
    id: string;
    magic: number | null;
    comments: Set<string>;
    count: number;
  }

  const eaGroupMap = new Map<string, EaGroup>();
  let manualCount = 0;
  let eaCount = 0;

  for (const t of allTrades) {
    let tags: string[] = [];
    try {
      if (t.tagsJson) tags = JSON.parse(t.tagsJson);
    } catch {
      tags = [];
    }

    const isEa = tags.some(
      (tag) =>
        tag.toLowerCase() === "ea" ||
        tag.toLowerCase().startsWith("magic:") ||
        tag.toLowerCase().startsWith("ea:"),
    );
    const isManual = !isEa || tags.some((tag) => tag.toLowerCase() === "manual" && !isEa);

    if (isManual) manualCount++;
    if (isEa) {
      eaCount++;

      // Find magic number tag if any: Magic:12345
      const magicTag = tags.find((tag) => tag.toLowerCase().startsWith("magic:"));
      let magicNum: number | null = null;
      if (magicTag) {
        const parsed = parseInt(magicTag.replace(/^magic:/i, "").trim(), 10);
        if (!isNaN(parsed) && parsed !== 0) {
          magicNum = parsed;
        }
      }
      if (magicNum === null && t.notes) {
        const match = t.notes.match(/magic:\s*(\d+)/i);
        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed !== 0) {
            magicNum = parsed;
          }
        }
      }

      // Collect custom comment / strategy names (excluding standard tags)
      const customComments = tags
        .filter((tag) => {
          const lower = tag.trim().toLowerCase();
          if (!lower) return false;
          if (STANDARD_TAGS.has(lower)) return false;
          if (lower.startsWith("magic:")) return false;
          if (lower.startsWith("hit ")) return false;
          if (lower.endsWith(" exit")) return false;
          if (lower.endsWith(" order")) return false;
          // Ignore pure numeric strings which might be order tickets
          if (/^\d+$/.test(lower)) return false;
          return true;
        })
        .map((s) => s.replace(/^ea:/i, "").trim())
        .filter(Boolean);

      // Determine identity key: Magic number is the primary identity!
      const groupKey =
        magicNum !== null
          ? `magic:${magicNum}`
          : customComments.length > 0
            ? `ea:${customComments[0]}`
            : "ea:unknown";

      let group = eaGroupMap.get(groupKey);
      if (!group) {
        group = {
          id: groupKey,
          magic: magicNum,
          comments: new Set<string>(),
          count: 0,
        };
        eaGroupMap.set(groupKey, group);
      }

      group.count++;
      for (const comment of customComments) {
        group.comments.add(comment);
      }
    }
  }

  const eas = Array.from(eaGroupMap.values())
    .map((g) => {
      const commentsList = Array.from(g.comments);
      let displayName = "";

      if (g.magic !== null) {
        if (commentsList.length === 0) {
          displayName = `${g.magic}#EA`;
        } else {
          displayName = `${g.magic}#${commentsList.join("#")}`;
        }
      } else {
        if (commentsList.length === 0) {
          displayName = "EA: Unknown";
        } else {
          displayName = `EA#${commentsList.join("#")}`;
        }
      }

      return {
        id: g.magic !== null ? String(g.magic) : g.id,
        name: displayName,
        magic: g.magic,
        comments: commentsList,
        count: g.count,
      };
    })
    .sort((a, b) => b.count - a.count);

  return ok({
    eas,
    totalManual: manualCount,
    totalEa: eaCount,
    totalTrades: allTrades.length,
  });
});
