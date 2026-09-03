"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { aiGateway, EMBEDDING_MODEL } from "./lib/gateway";
import { embedMany } from "ai";
// pdf-parse-fork has no bundled types
// @ts-expect-error -- untyped CommonJS module
import pdf from "pdf-parse-fork";

const CHUNK_SIZE = 1100;
const CHUNK_OVERLAP = 180;
// OpenAI caps embedding batches; stay well inside it.
const EMBED_BATCH = 64;

// Split on paragraph boundaries where possible so chunks stay semantically whole,
// falling back to hard slicing for very long paragraphs.
function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      flush();
      let i = 0;
      while (i < paragraph.length) {
        chunks.push(paragraph.slice(i, i + CHUNK_SIZE));
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > CHUNK_SIZE) {
      // Carry the tail of the previous chunk forward for continuity
      const tail = current.slice(-CHUNK_OVERLAP);
      flush();
      current = `${tail}\n\n${paragraph}`;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();

  return chunks.filter((c) => c.length > 20);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const processSource = internalAction({
  args: { sourceId: v.id("knowledgeSources") },
  handler: async (ctx, args) => {
    const source = await ctx.runQuery(internal.knowledge.getSourceInternal, {
      sourceId: args.sourceId,
    });
    if (!source) return { success: false, error: "Source not found" };

    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.knowledge.markFailed, {
        sourceId: args.sourceId,
        reason:
          "AI_GATEWAY_API_KEY is not set on the Convex deployment. Run: npx convex env set AI_GATEWAY_API_KEY <key>",
      });
      return { success: false, error: "Missing AI_GATEWAY_API_KEY" };
    }

    await ctx.runMutation(internal.knowledge.markProcessing, {
      sourceId: args.sourceId,
    });

    try {
      // --- 1. Extract plain text -------------------------------------------
      let text = "";

      if (source.kind === "text" || source.kind === "faq") {
        text = source.rawText ?? "";
      } else if (source.kind === "url") {
        const response = await fetch(source.url!, {
          headers: { "User-Agent": "Magic Agent knowledge crawler" },
          redirect: "follow",
        });
        if (!response.ok) {
          throw new Error(
            `Fetching ${source.url} returned HTTP ${response.status}`
          );
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/pdf")) {
          const buffer = Buffer.from(await response.arrayBuffer());
          text = (await pdf(buffer)).text ?? "";
        } else {
          text = htmlToText(await response.text());
        }
      } else {
        const blob = await ctx.storage.get(source.storageId!);
        if (!blob) throw new Error("Uploaded file is no longer in storage");
        const buffer = Buffer.from(await blob.arrayBuffer());
        const mime = source.mimeType ?? "";

        if (mime === "application/pdf" || source.filename?.endsWith(".pdf")) {
          text = (await pdf(buffer)).text ?? "";
        } else if (mime.startsWith("text/") || mime === "application/json") {
          text = buffer.toString("utf-8");
        } else if (mime === "text/html") {
          text = htmlToText(buffer.toString("utf-8"));
        } else {
          // Best effort: most remaining knowledge formats are text underneath
          text = buffer.toString("utf-8");
        }
        if (mime === "text/html") text = htmlToText(text);
      }

      text = text.replace(/\r\n/g, "\n").trim();
      if (!text) {
        throw new Error(
          "No readable text could be extracted. Scanned PDFs and images are not supported yet — paste the text instead."
        );
      }

      // --- 2. Chunk ---------------------------------------------------------
      const chunks = chunkText(text);
      if (chunks.length === 0) {
        throw new Error("Text was too short to index (minimum ~20 characters).");
      }

      // --- 3. Embed and persist in batches ---------------------------------
      for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
        const batch = chunks.slice(start, start + EMBED_BATCH);
        const { embeddings, usage } = await embedMany({
          model: aiGateway().embedding(EMBEDDING_MODEL),
          values: batch,
        });

        // Recorded per batch rather than per source: a large document is
        // several calls, and a failure part-way should still have billed for
        // the batches that did run.
        await ctx.runMutation(internal.usage.record, {
          workspaceId: source.workspaceId,
          agentId: source.agentId,
          source: "ingest",
          model: EMBEDDING_MODEL,
          kind: "embedding",
          inputTokens: usage?.tokens ?? 0,
          outputTokens: 0,
        });

        await ctx.runMutation(internal.knowledge.saveChunks, {
          sourceId: args.sourceId,
          charCount: text.length,
          chunks: batch.map((chunkText, idx) => ({
            text: chunkText,
            order: start + idx,
            embedding: embeddings[idx],
          })),
        });
      }

      await ctx.runMutation(internal.knowledge.markReady, {
        sourceId: args.sourceId,
      });
      return { success: true, chunks: chunks.length, chars: text.length };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[ingest] failed", args.sourceId, reason);
      await ctx.runMutation(internal.knowledge.markFailed, {
        sourceId: args.sourceId,
        reason,
      });
      return { success: false, error: reason };
    }
  },
});
