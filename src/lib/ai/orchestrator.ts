import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  searchPhotos,
  type ImageAttribution,
} from "@/lib/images/unsplash";

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

const ImageSlotSchema = z.object({
  id: z.string().describe("Unique placeholder id used in the HTML src, e.g. __IMG_1__"),
  description: z
    .string()
    .describe(
      "Detailed, specific description of the desired image for photo search, e.g. 'aerial view of Tokyo skyline at sunset'",
    ),
  width: z.number().describe("Desired image width in pixels"),
  height: z.number().describe("Desired image height in pixels"),
});

const GenerationResultSchema = z.object({
  html: z
    .string()
    .describe(
      "Complete, self-contained HTML document. Image src attributes must use placeholder ids like src=\"__IMG_1__\" matching the images array.",
    ),
  images: z
    .array(ImageSlotSchema)
    .describe("Array of image slots used in the HTML, one entry per unique placeholder."),
});

type GenerationResult = z.infer<typeof GenerationResultSchema>;

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

const STRUCTURED_OUTPUT_MODELS = new Set([
  "claude-sonnet-4-5-20250514",
  "claude-haiku-4-5-20250514",
  "claude-opus-4-5-20250514",
  "claude-sonnet-4-6-20250819",
  "claude-opus-4-6-20250918",
]);

function resolveModel(configured: string): {
  model: string;
  supportsStructured: boolean;
} {
  const aliases: Record<string, string> = {
    "claude-3-5-sonnet-latest": "claude-3-5-sonnet-20241022",
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250514",
    "claude-haiku-4-5": "claude-haiku-4-5-20250514",
  };
  const model = aliases[configured] ?? configured;
  const supportsStructured =
    STRUCTURED_OUTPUT_MODELS.has(model) ||
    model.startsWith("claude-sonnet-4-5") ||
    model.startsWith("claude-sonnet-4-6") ||
    model.startsWith("claude-opus-4-5") ||
    model.startsWith("claude-opus-4-6") ||
    model.startsWith("claude-haiku-4-5");
  return { model, supportsStructured };
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const TOKEN_EFFICIENCY_RULES = [
  "",
  "Token efficiency (IMPORTANT — output WILL be truncated if too long):",
  //"- Use Tailwind's DEFAULT theme. Do NOT add a tailwind.config or custom colors/fonts.",
  // "- Do NOT import Google Fonts or add <style> blocks unless absolutely critical.",
  //"- Keep copy concise: short headlines, 1–2 sentence descriptions. No lorem ipsum filler.",
  "- Prefer Tailwind utility classes over inline styles.",
  "- Aim for a complete, working page — a finished short page beats a truncated elaborate one.",
].join("\n");

const SYSTEM_STRUCTURED = [
  "You are a creative web designer and front-end engineer.",
  "Generate a COMPLETE, SELF-CONTAINED HTML document for the requested site.",
  "",
  "Constraints:",
  '- Must include: <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.',
  '- Use Tailwind via the official CDN: <script src="https://cdn.tailwindcss.com"></script>.',
  "- You may extend tailwind.config for custom colors/fonts if it improves the design.",
  "- You may use Google Fonts via a <link> tag for a polished typographic feel.",
  "- Must be responsive (mobile-first) and use accessible headings.",
  "- Include at least: a hero section, 3–6 feature points, a call-to-action section, and a footer.",
  "- Prefer neutral spacing, legible typography, and a cohesive color palette.",
  "- Keep copy concise and purposeful — no lorem ipsum filler.",
  "",
  "Image handling:",
  "- For EVERY image in the page, create a placeholder id like __IMG_1__, __IMG_2__, etc.",
  '- In the HTML, set the src to exactly the placeholder id: src="__IMG_1__"',
  "- In the images array, provide a DETAILED, SPECIFIC description of what the image should show. This will be used to search a stock photo library, so be concrete (e.g. 'close-up of latte art in a ceramic mug on a wooden table', not just 'coffee').",
  "- Include width and height for each image.",
].join("\n");

const SYSTEM_FALLBACK = [
  "You are a creative web designer and front-end engineer.",
  "Generate a COMPLETE, SELF-CONTAINED HTML document for the requested site.",
  "Output HTML ONLY (no markdown fences, no explanations).",
  '- Must include: <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.',
  '- Use Tailwind via the official CDN: <script src="https://cdn.tailwindcss.com"></script>.',
  "- Must be responsive (mobile-first) and use accessible headings.",
  "- Include at least: a hero section, 3–6 feature points, a call-to-action section, and a footer.",
  "- Prefer neutral spacing, legible typography, and a cohesive color palette.",
  "- For EVERY <img> tag, write a DESCRIPTIVE alt attribute that describes the desired image.",
  '- Use src="https://placehold.co/800x600" as a temporary placeholder for all images.',
  "- Include width and height attributes on images when possible.",
  TOKEN_EFFICIENCY_RULES,
].join("\n");

// ---------------------------------------------------------------------------
// Image resolution
// ---------------------------------------------------------------------------

type ResolveImageOptions = { skipAttribution?: boolean };

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resolveImageSlots(
  html: string,
  images: GenerationResult["images"],
  options?: ResolveImageOptions,
): Promise<{ html: string; attributions: ImageAttribution[] }> {
  if (images.length === 0) return { html, attributions: [] };

  const results = await searchPhotos(
    images.map((img) => ({
      query: img.description,
      w: img.width,
      h: img.height,
    })),
  );

  const attributions: ImageAttribution[] = [];
  let patched = html;

  for (const img of images) {
    const result = results.get(img.description);
    if (!result) continue;

    patched = patched.replaceAll(img.id, result.url);
    attributions.push({
      photographerName: result.photographerName,
      photographerUrl: result.photographerUrl,
      photoUrl: result.photoUrl,
    });
  }

  if (attributions.length > 0 && !options?.skipAttribution) {
    patched = injectAttribution(patched, attributions);
  }

  return { html: patched, attributions };
}

function injectAttribution(
  html: string,
  attributions: ImageAttribution[],
): string {
  const unique = new Map<string, ImageAttribution>();
  for (const a of attributions) unique.set(a.photoUrl, a);

  const items = [...unique.values()]
    .map((a) => {
      const name = escapeHtmlText(a.photographerName);
      return `<li style="margin:0 0 6px 0;color:#9ca3af;font-size:11px;line-height:1.45"><a href="${a.photoUrl}?utm_source=websitepls&utm_medium=referral" target="_blank" rel="noopener noreferrer" style="color:#6b7280;text-decoration:underline">Photo</a> by <a href="${a.photographerUrl}?utm_source=websitepls&utm_medium=referral" target="_blank" rel="noopener noreferrer" style="color:#6b7280;text-decoration:underline">${name}</a></li>`;
    })
    .join("");

  const block = `<div role="contentinfo" aria-label="Photo credits" style="border-top:1px solid #e5e7eb;background:#fafafa">
  <div style="padding:10px 16px 6px;text-align:center;font-size:11px;color:#9ca3af">Images from <a href="https://unsplash.com/?utm_source=websitepls&utm_medium=referral" target="_blank" rel="noopener noreferrer" style="color:#6b7280;text-decoration:underline">Unsplash</a></div>
  <div style="max-height:5.5rem;overflow-y:auto;overflow-x:hidden;padding:0 16px 12px;-webkit-overflow-scrolling:touch">
    <ul style="margin:0;padding-left:1.15em;list-style:disc">${items}</ul>
  </div>
</div>`;

  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + block + html.slice(bodyClose);
  }
  return html + block;
}

// ---------------------------------------------------------------------------
// Fallback: regex-based image extraction for older models
// ---------------------------------------------------------------------------

function extractHtml(text: string): string {
  const match = text.match(/<html[\s\S]*<\/html>/i);
  if (match?.[0]) return match[0].trim();
  return text.trim();
}

async function resolveImagesFromAltText(
  html: string,
  options?: ResolveImageOptions,
): Promise<{ html: string; attributions: ImageAttribution[] }> {
  const imgTagRe = /<img\b[^>]*>/gi;
  const slots: { fullMatch: string; alt: string; w: number; h: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = imgTagRe.exec(html)) !== null) {
    const tag = m[0];
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = altMatch?.[1]?.trim();
    if (!alt) continue;

    slots.push({
      fullMatch: tag,
      alt,
      w: parseInt(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] ?? "800", 10),
      h: parseInt(tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] ?? "600", 10),
    });
  }

  if (slots.length === 0) return { html, attributions: [] };

  const results = await searchPhotos(
    slots.map((s) => ({ query: s.alt, w: s.w, h: s.h })),
  );

  const attributions: ImageAttribution[] = [];
  let patched = html;

  for (const slot of slots) {
    const result = results.get(slot.alt);
    if (!result) continue;

    const newTag = slot.fullMatch.replace(
      /\bsrc\s*=\s*["'][^"']*["']/i,
      `src="${result.url}"`,
    );
    patched = patched.replace(slot.fullMatch, newTag);
    attributions.push({
      photographerName: result.photographerName,
      photographerUrl: result.photographerUrl,
      photoUrl: result.photoUrl,
    });
  }

  if (attributions.length > 0 && !options?.skipAttribution) {
    patched = injectAttribution(patched, attributions);
  }

  return { html: patched, attributions };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export type ProgressCallback = (step: string, percent: number) => void;

export async function runGenerationPipeline(input: {
  projectId: string;
  userPrompt: string;
  onProgress?: ProgressCallback;
}): Promise<{ html: string }> {
  void input.projectId;
  const progress = input.onProgress ?? (() => {});

  const apiKey = getRequiredEnv("ANTHROPIC_API_KEY");
  const configured =
    process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250514";
  const { model, supportsStructured } = resolveModel(configured);
  const anthropic = new Anthropic({ apiKey });

  const userContent = [
    `User prompt:\n${input.userPrompt}`,
    "",
    "Return the HTML document. Ensure the code includes the Tailwind CDN script tag.",
  ].join("\n");

  // ---- Structured output path (Claude 4.5+) ----
  // High max_tokens implies a long completion; the Anthropic SDK requires streaming
  // for those (non-streaming is capped at ~10 min). See long-requests in SDK README.
  if (supportsStructured) {
    progress("Generating your website…", 20);

    const stream = anthropic.messages.stream({
      model,
      max_tokens: 32768,
      temperature: 0.7,
      system: SYSTEM_STRUCTURED,
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: zodOutputFormat(GenerationResultSchema),
      },
    });
    const response = await stream.finalMessage();

    progress("Processing response…", 60);

    const parsed = response.parsed_output;
    if (!parsed?.html) {
      throw new Error("Model returned no HTML in structured output.");
    }

    const images = parsed.images ?? [];
    console.log(
      `[orchestrator] structured output: ${images.length} image slot(s), stop_reason=${response.stop_reason}`,
    );

    progress("Searching for matching photos…", 70);

    let { html, attributions } = await resolveImageSlots(
      parsed.html,
      images,
      { skipAttribution: true },
    );

    if (/__IMG_\d+__/.test(html)) {
      console.warn(
        "[orchestrator] unresolved __IMG_ placeholders remain — falling back to alt-text resolution",
      );
      const next = await resolveImagesFromAltText(html, {
        skipAttribution: true,
      });
      html = next.html;
      attributions = attributions.concat(next.attributions);
    }

    if (attributions.length > 0) {
      html = injectAttribution(html, attributions);
    }

    progress("Finalizing…", 90);
    return { html };
  }

  // ---- Fallback path (older models) ----
  progress("Generating your website…", 20);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 16384,
    temperature: 0.7,
    system: SYSTEM_FALLBACK,
    messages: [{ role: "user", content: userContent }],
  });

  progress("Processing response…", 60);

  const textBlock = response.content.find((c) => c.type === "text");
  if (
    !textBlock ||
    typeof (textBlock as { text?: unknown }).text !== "string"
  ) {
    throw new Error("Model returned no text content.");
  }
  const text = (textBlock as { text: string }).text;

  const rawHtml = extractHtml(text);
  if (!rawHtml.toLowerCase().includes("<html")) {
    throw new Error("Model did not return an HTML document.");
  }

  progress("Searching for matching photos…", 70);

  const { html } = await resolveImagesFromAltText(rawHtml);

  progress("Finalizing…", 90);
  return { html };
}
