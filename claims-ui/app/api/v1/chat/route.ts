import { NextRequest } from "next/server";
import {
  jsonWithSecurityHeaders,
  sameOriginGuard,
  validateJsonRequest,
} from "@/lib/server-security";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const CHAT_UPSTREAM_TIMEOUT_MS = 12_000;
const OUTPUT_GUARDRAIL =
  "Reply as an operations assistant for a health-insurance claims portal. Use only available portal data. Format as 4-6 short, decision-ready points, one point per line. Include counts, amounts, claim refs, statuses, dates, and next action when available. If data is unavailable, say exactly what is unavailable. No greetings, no filler, no hedging, no internal reasoning, and no extra suggestions unless explicitly asked.";
const REASONING_BLOCK_RE = /<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi;
const INLINE_REASONING_TAG_RE = /<\/?(think|analysis|reasoning)\b[^>]*>/gi;
const OPEN_REASONING_TAG_RE = /<(think|analysis|reasoning)\b[^>]*>/i;
const INTERNAL_LINE_RE =
  /^\s*(okay|alright|let me|i(?:'m| am)? going to|i(?:'m| am)? checking|looking at|the user asked|the request is|the prompt is|i need to|we need to|make sure to|need to keep it|just focus on|the key point here is|the rest of the data|formatting instruction)\b.*$/i;
const TRAILING_FILLER_RE =
  /\b(let me know if you need anything else|let me know if you want more detail|tell me if you want more detail|i can help with that|i can also help|would you like me to|if you want,? i can)\b[.! ]*$/i;
const LEADING_HEDGE_RE =
  /^(it looks like|it appears|it seems|likely|probably|i think)\b[\s,:-]*/i;
const MULTISPACE_RE = /[ \t]{2,}/g;

type ChatMessage = {
  role?: string;
  content?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyOutputGuardrail(messages: ChatMessage[]): ChatMessage[] {
  const nextMessages = [...messages];

  for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
    const message = nextMessages[i];
    if (message.role !== "user" || !message.content) continue;
    if (message.content.includes(OUTPUT_GUARDRAIL)) return nextMessages;

    nextMessages[i] = {
      ...message,
      content: `${message.content}\n\nFormatting instruction: ${OUTPUT_GUARDRAIL}`,
    };
    return nextMessages;
  }

  return nextMessages;
}

function trimReply(reply: unknown): string {
  if (typeof reply !== "string") return "No response.";
  const withoutReasoningBlocks = reply.replace(REASONING_BLOCK_RE, "");
  const reasoningTagIndex = withoutReasoningBlocks.search(OPEN_REASONING_TAG_RE);
  const candidateReply =
    reasoningTagIndex >= 0
      ? withoutReasoningBlocks.slice(0, reasoningTagIndex)
      : withoutReasoningBlocks;

  const preamblePattern =
    /^(sure|certainly|of course|here(?:'| i)?s|based on|according to|i can|let me|the answer is)\b[\s,:-]*/i;

  let lines = candidateReply
    .replace(INLINE_REASONING_TAG_RE, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((line) => !INTERNAL_LINE_RE.test(line))
    .filter(Boolean)
    .map((line) => line.replace(preamblePattern, "").replace(LEADING_HEDGE_RE, "").trim())
    .map((line) => line.replace(TRAILING_FILLER_RE, "").replace(MULTISPACE_RE, " ").trim())
    .filter(Boolean);

  if (lines.length <= 1 && lines[0] && lines[0].length > 180) {
    lines = lines[0]
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  return lines.slice(0, 6).join("\n") || "No response.";
}

export async function POST(req: NextRequest) {
  try {
    const blockedForOrigin = sameOriginGuard(req);
    if (blockedForOrigin) return blockedForOrigin;

    const blockedForContentType = validateJsonRequest(req);
    if (blockedForContentType) return blockedForContentType;

    const rawPayload = await req.json().catch(() => null);
    const payload = isPlainRecord(rawPayload) ? rawPayload : {};
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const cookie = req.headers.get("cookie") ?? "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_UPSTREAM_TIMEOUT_MS);
    let upstream: Response;

    try {
      upstream = await fetch(`${API_URL}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": cookie,
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...payload,
          messages: applyOutputGuardrail(messages),
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const upstreamData = contentType.includes("application/json")
      ? await upstream.json().catch(() => ({ reply: "Chat service returned an invalid response." }))
      : { reply: "Chat service is temporarily unavailable." };
    const data = isPlainRecord(upstreamData)
      ? upstreamData
      : { reply: "Chat service returned an invalid response." };
    data.reply = trimReply(data.reply);
    return jsonWithSecurityHeaders(data, { status: upstream.status });
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return jsonWithSecurityHeaders(
      { reply: isAbort ? "Chat service timed out. Try a narrower claims question." : "Chat service is temporarily unavailable." },
      { status: isAbort ? 504 : 503 },
    );
  }
}
