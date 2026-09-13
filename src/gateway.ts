/**
 * One OpenAI-compatible client for Vercel AI Gateway and OpenRouter (D75, D78).
 *
 * Live GET /v1/models. The list is every text model the catalog marks as able to
 * reason, including open weights. No per-provider SDKs. CI never calls a live
 * gateway — tests inject a completer and a catalog.
 */
import {
  envVarFor,
  resolveGateway,
  resolveKey,
  type GatewayName,
} from "./keyring.js";
import { PredictRefusal } from "./predict-errors.js";

export const GATEWAY_BASE: Record<GatewayName, string> = {
  vercel: "https://ai-gateway.vercel.sh/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export interface CatalogModel {
  id: string;
  name?: string;
}

export interface CompleteRequest {
  gateway: GatewayName;
  model: string;
  system: string;
  user: string;
}

export interface CompleteResponse {
  content: string;
  model: string;
}

export type Completer = (req: CompleteRequest) => Promise<CompleteResponse>;
export type Catalog = (gateway: GatewayName) => Promise<CatalogModel[]>;

let completerOverride: Completer | undefined;
let catalogOverride: Catalog | undefined;
let fetchOverride: typeof fetch | undefined;

/** Tests inject a fake model so CI never calls a live gateway. */
export function useCompleter(fn: Completer | undefined): void {
  completerOverride = fn;
}

/** Tests inject a fake catalog so listing does not hit the network. */
export function useCatalog(fn: Catalog | undefined): void {
  catalogOverride = fn;
}

export function useFetch(fn: typeof fetch | undefined): void {
  fetchOverride = fn;
}

export function hasCompleterOverride(): boolean {
  return completerOverride !== undefined;
}

export function hasCatalogOverride(): boolean {
  return catalogOverride !== undefined;
}

function fetcher(): typeof fetch {
  return fetchOverride ?? fetch;
}

/**
 * The key and gateway to use, or a refusal that names the remedy.
 *
 * A fake completer in tests skips the key check, so those tests do not need a store.
 */
export async function requireGateway(requested?: GatewayName): Promise<{
  gateway: GatewayName;
  key: string;
}> {
  if (completerOverride || catalogOverride) {
    return { gateway: requested ?? "vercel", key: "test" };
  }

  const gateway = await resolveGateway(requested);
  if (!gateway) {
    throw new PredictRefusal(noKeyMessage());
  }
  const key = await resolveKey(gateway);
  if (!key) {
    throw new PredictRefusal(noKeyMessage());
  }
  return { gateway, key };
}

export function noKeyMessage(): string {
  return [
    `A prediction needs a model, and this terminal has no gateway key.`,
    ``,
    `Save one:  ath key set vercel`,
    `       or  ath key set openrouter`,
    ``,
    `Or set ${envVarFor("vercel")} or ${envVarFor("openrouter")} in the environment.`,
    ``,
    `In Claude Code, Cursor, or Codex the model is already there. Run`,
    `\`ath predict <benchmark> --json\` for the evidence, then write the`,
    `prediction with \`ath log\`. You do not need a key, and there is no`,
    `Athletic Standard subscription.`,
  ].join("\n");
}

export async function listReasoningModels(gateway: GatewayName, key?: string): Promise<CatalogModel[]> {
  if (catalogOverride) return catalogOverride(gateway);
  const resolved = key ?? (await resolveKey(gateway));
  if (!resolved) throw new PredictRefusal(noKeyMessage());

  const data = await gatewayGet(gateway, resolved, "/models");
  const raw = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
  const models: CatalogModel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : undefined;
    if (!id) continue;
    if (!isReasoningTextModel(rec)) continue;
    const name = typeof rec.name === "string" ? rec.name : undefined;
    models.push(name ? { id, name } : { id });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

/**
 * Text in, text out, and the catalog marks it as able to reason (D78).
 *
 * Image, audio, and embedding models are out. We do not keep a favourite-labs list.
 */
export function isReasoningTextModel(raw: Record<string, unknown>): boolean {
  const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
  const type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";

  if (NON_TEXT_TYPES.has(type)) return false;
  if (NON_TEXT_ID.test(id)) return false;

  const architecture =
    raw.architecture && typeof raw.architecture === "object"
      ? (raw.architecture as Record<string, unknown>)
      : undefined;
  const input = modalities(architecture?.input_modalities ?? architecture?.input_modality);
  const output = modalities(architecture?.output_modalities ?? architecture?.output_modality);
  const modality = typeof architecture?.modality === "string" ? architecture.modality.toLowerCase() : "";

  if (input.length > 0 && !input.includes("text")) return false;
  if (output.length > 0 && !output.includes("text")) return false;
  if (modality && !modality.includes("text")) return false;
  if (input.some((m) => NON_TEXT_MODALITY.has(m)) && !input.includes("text")) return false;
  if (output.some((m) => NON_TEXT_MODALITY.has(m))) return false;

  return hasReasoningMark(raw);
}

const NON_TEXT_TYPES = new Set([
  "embedding",
  "embeddings",
  "image",
  "audio",
  "transcription",
  "tts",
  "moderation",
  "rerank",
  "video",
  "vision",
]);

const NON_TEXT_MODALITY = new Set(["image", "audio", "video", "embedding"]);

const NON_TEXT_ID = /embedding|whisper|tts|dall-e|imagen|moderation|rerank|wav|audio/;

function modalities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  if (typeof value === "string") return value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return [];
}

function hasReasoningMark(raw: Record<string, unknown>): boolean {
  if (raw.reasoning === true) return true;
  if (raw.reasoning && typeof raw.reasoning === "object") return true;

  const capabilities =
    raw.capabilities && typeof raw.capabilities === "object"
      ? (raw.capabilities as Record<string, unknown>)
      : undefined;
  if (capabilities?.reasoning === true) return true;

  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [];
  if (tags.some((t) => t === "reasoning" || t === "reasoning-effort" || t.includes("reasoning"))) {
    return true;
  }

  const params = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.map((p) => String(p).toLowerCase())
    : [];
  return params.some(
    (p) => p === "reasoning" || p === "include_reasoning" || p === "reasoning_effort",
  );
}

export async function complete(req: CompleteRequest): Promise<CompleteResponse> {
  if (completerOverride) return completerOverride(req);

  const key = await resolveKey(req.gateway);
  if (!key) throw new PredictRefusal(noKeyMessage());

  const body = await gatewayPost(req.gateway, key, "/chat/completions", {
    model: req.model,
    temperature: 0,
    max_tokens: 8192,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  });

  const content = contentFrom(body);
  if (!content) {
    throw new PredictRefusal(
      `the ${req.gateway} gateway returned no text for ${req.model}. Try another model from \`ath models\`.`,
    );
  }
  const model = typeof body.model === "string" ? body.model : req.model;
  return { content, model };
}

function contentFrom(body: Record<string, unknown>): string | undefined {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = (first as { message?: { content?: unknown } }).message;
  if (typeof message?.content === "string" && message.content.trim()) return message.content;
  if (typeof (first as { text?: unknown }).text === "string") {
    const text = (first as { text: string }).text.trim();
    return text || undefined;
  }
  return undefined;
}

async function gatewayGet(
  gateway: GatewayName,
  key: string,
  path: string,
): Promise<Record<string, unknown> & { data?: unknown[] }> {
  const res = await fetcher()(`${GATEWAY_BASE[gateway]}${path}`, {
    headers: gatewayHeaders(gateway, key),
  });
  return readJson(gateway, res);
}

async function gatewayPost(
  gateway: GatewayName,
  key: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetcher()(`${GATEWAY_BASE[gateway]}${path}`, {
    method: "POST",
    headers: { ...gatewayHeaders(gateway, key), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(gateway, res);
}

function gatewayHeaders(gateway: GatewayName, key: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (gateway === "openrouter") {
    headers["http-referer"] = "https://athleticstandard.ai";
    headers["x-title"] = "Athletic Standard";
  }
  return headers;
}

async function readJson(gateway: GatewayName, res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* some error pages are not JSON */
  }
  if (!res.ok) {
    const msg =
      typeof body.error === "string"
        ? body.error
        : body.error && typeof body.error === "object" && "message" in body.error
          ? String((body.error as { message: unknown }).message)
          : res.statusText;
    throw new PredictRefusal(
      `the ${gateway} gateway refused the call (${res.status}). ${msg}`.trim() +
        (res.status === 401 || res.status === 403
          ? ` Check the key with \`ath key\`.`
          : ""),
    );
  }
  return body;
}

/** Closest live names, so a typo is a list rather than a dead end. */
export function closestModelIds(wanted: string, catalog: CatalogModel[], n = 5): string[] {
  const needle = wanted.toLowerCase();
  return catalog
    .map((m) => ({ id: m.id, score: closeness(needle, m.id.toLowerCase()) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.id);
}

function closeness(a: string, b: string): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  const contains = a.includes(b) || b.includes(a) ? 3 : 0;
  const tail = a.includes("/") && b.endsWith(a.slice(a.indexOf("/") + 1)) ? 4 : 0;
  return shared + contains + tail;
}
