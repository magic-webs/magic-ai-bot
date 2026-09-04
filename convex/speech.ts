"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateSpeech } from "ai";
import { aiGateway, SPEECH_MODEL } from "./lib/gateway";

/**
 * Spoken greetings.
 *
 * The agent screen opens on a voice orb, and this is what it plays: the agent
 * introducing itself to the operator by name.
 *
 * The audio is stored rather than returned inline. A base64 payload would have
 * to cross the websocket as a string and then be turned back into something
 * playable on the client, and `expo-audio` takes a URL on every platform it
 * runs on — data URIs are only reliable on web. Convex storage hands back a
 * plain https URL, which also means the device can cache it.
 */

/** A greeting is one or two sentences; anything longer is a mistake upstream. */
const MAX_GREETING_CHARS = 240;

export const greet = action({
  args: {
    agentId: v.id("agents"),
    /** The operator's own name, when the caller knows it. */
    listener: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ url: string; text: string; mediaType: string }> => {
    const found = await ctx.runQuery(internal.agents.getInternal, {
      agentId: args.agentId,
    });
    if (!found) throw new Error("Agent not found");
    const { agent, workspace } = found;

    // Only an administrator, or this workspace's own users, may spend model
    // credits against it.
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: workspace._id,
    });

    /* Written here rather than asked of a chat model first. A greeting that has
       to be generated costs a second call and a second failure mode, and the
       agent already carries the two things the line needs: who it is and what
       it does. */
    /* The owner's name if they have set one, the company name if not — an
       agent saying "Hi Acme Roofing, I'm Priya" is odd but better than "Hi
       there", and the caller can still override for a named operator. */
    const who =
      args.listener?.trim() || workspace.ownerName?.trim() || workspace.name;
    const text = [
      `Hi ${who}, I'm ${agent.botName}, your ${agent.role}.`,
      agent.kind === "router"
        ? "I answer first on every channel and pass each conversation to whoever should handle it."
        : agent.kind === "follow_up"
          ? "I keep an eye on conversations that have gone quiet and nudge them along."
          : "I take the conversations the front desk sends my way.",
    ]
      .join(" ")
      .slice(0, MAX_GREETING_CHARS);

    const result = await generateSpeech({
      model: aiGateway().speech(SPEECH_MODEL),
      text,
      // mp3 rather than wav: this is streamed to a phone, and the difference is
      // roughly tenfold for speech.
      outputFormat: "mp3",
      language: (workspace.locale || "en").slice(0, 2),
    });

    const mediaType = result.audio.mediaType || "audio/mpeg";
    const stored = await ctx.storage.store(
      new Blob([new Uint8Array(result.audio.uint8Array)], { type: mediaType })
    );

    const url = await ctx.storage.getUrl(stored);
    if (!url) throw new Error("Stored the greeting but could not resolve a URL");

    return { url, text, mediaType };
  },
});
