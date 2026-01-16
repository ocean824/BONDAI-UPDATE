// server/services/bondDocumentAiService.ts
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import mammoth from "mammoth";
import { config } from "../config";

const openai = config.openai.enabled
  ? new OpenAI({
      baseURL: config.openai.baseUrl,
      apiKey: config.openai.apiKey,
    })
  : null;

export interface BondDocSummaryResult {
  summary: string;
  tags: string[];
}

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  const resolved = path.resolve(filePath);
  const buffer = await fs.readFile(resolved);

  if (mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf")) {
    // Dynamic import for pdf-parse since it doesn't have proper ESM exports
    const pdfParseModule = await import("pdf-parse") as any;
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const data = await pdfParse(buffer);
    return data.text || "";
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filePath.toLowerCase().endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  // For other types, we don't yet support extraction
  return "";
}

export async function summarizeBondDocumentFromFile(
  filePath: string,
  mimeType: string
): Promise<BondDocSummaryResult | null> {
  if (!openai) {
    // OpenAI not configured: do not fabricate anything, just skip
    return null;
  }

  const text = await extractTextFromFile(filePath, mimeType);
  if (!text.trim()) {
    // Nothing to summarize
    return null;
  }

  const truncated = text.length > 16000 ? text.slice(0, 16000) : text;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You summarize and tag *real* bond-related documents (indentures, term sheets, offering memoranda, court orders, etc.).

Rules:
- Use ONLY the text provided.
- Do NOT invent or hallucinate facts that are not present.
- Output a JSON object with keys:
  - "summary": a concise 3–5 sentence overview.
  - "tags": an array of 3–8 short tags such as ["indenture", "secured", "Article 9", "UCC", "maturity 2030"].
- Never include chain-of-thought in the output.
        `.trim(),
      },
      {
        role: "user",
        content: truncated,
      },
    ],
    max_completion_tokens: 512,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t: unknown) => typeof t === "string")
    : [];

  if (!summary && tags.length === 0) {
    return null;
  }

  return { summary, tags };
}
