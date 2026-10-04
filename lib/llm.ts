import { generateText, Output, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";

// Pick any model with two env vars. Add a provider here to support it everywhere.
export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER || "google";
  const model = process.env.LLM_MODEL || "gemini-flash-latest";
  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: process.env.LLM_API_KEY })(model);
    case "anthropic":
      return createAnthropic({ apiKey: process.env.LLM_API_KEY })(model);
    case "openai":
      return createOpenAI({ apiKey: process.env.LLM_API_KEY })(model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
        supportsStructuredOutputs: true,
      })(model);
    default:
      // Any other OpenAI-compatible endpoint (Groq, Together, Azure, a hospital gateway, ...)
      return createOpenAICompatible({
        name: provider,
        baseURL: process.env.LLM_BASE_URL!,
        apiKey: process.env.LLM_API_KEY,
        supportsStructuredOutputs: true,
      })(model);
  }
}

// `images` (e.g. pages of a scanned form) need a vision-capable model.
export async function askForObject<T>(schema: z.ZodType<T>, system: string, prompt: string, images: Buffer[] = []): Promise<T> {
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema }),
    system,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "file" as const, mediaType: "image/png", data }))],
      },
    ],
  });
  return output;
}
