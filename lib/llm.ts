import { generateText, Output, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";

// Pick any model with two env vars. Add a provider here to support it everywhere.
export function getModel(model = process.env.LLM_MODEL || "gemini-flash-latest"): LanguageModel {
  const provider = process.env.LLM_PROVIDER || "google";
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

// Backup model (same provider), used when the main one fails, e.g. Gemini's "high demand" 503s.
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || ((process.env.LLM_PROVIDER || "google") === "google" ? "gemini-flash-lite-latest" : "");

// `images` (e.g. pages of a scanned form) need a vision-capable model.
export async function askForObject<T>(schema: z.ZodType<T>, system: string, prompt: string, images: Buffer[] = []): Promise<T> {
  try {
    return await ask(getModel(), schema, system, prompt, images);
  } catch (e) {
    if (!FALLBACK_MODEL) throw e;
    console.warn(`Main AI model failed (${(e as Error).message}); trying ${FALLBACK_MODEL}`);
    return ask(getModel(FALLBACK_MODEL), schema, system, prompt, images);
  }
}

async function ask<T>(model: LanguageModel, schema: z.ZodType<T>, system: string, prompt: string, images: Buffer[]): Promise<T> {
  const { output } = await generateText({
    model,
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
