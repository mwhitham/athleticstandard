/**
 * The live list of text models that can reason, and the default saved next to
 * the athlete file (D78).
 *
 * The default is a model name, not a key. The key lives in the password store.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closestModelIds, listReasoningModels, requireGateway, type CatalogModel } from "./gateway.js";
import { PredictRefusal } from "./predict-errors.js";
import type { GatewayName } from "./keyring.js";

/** `athlete.ath.model` sits next to `athlete.ath.json`. */
export function defaultModelPath(athletePath: string): string {
  return athletePath.replace(/\.json$/i, ".model");
}

export function readDefaultModel(athletePath: string): string | undefined {
  const path = defaultModelPath(athletePath);
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8").trim().split(/\r?\n/)[0]?.trim();
  return line || undefined;
}

export function writeDefaultModel(athletePath: string, model: string): void {
  writeFileSync(defaultModelPath(athletePath), `${model}\n`, "utf8");
}

export async function loadCatalog(gateway?: GatewayName): Promise<{
  gateway: GatewayName;
  models: CatalogModel[];
}> {
  const resolved = await requireGateway(gateway);
  const models = await listReasoningModels(resolved.gateway, resolved.key);
  return { gateway: resolved.gateway, models };
}

/**
 * The model this run will call.
 *
 * `--model` wins. Then the saved default. Neither → stop. We do not guess, and we
 * do not reuse last week's backtest winner (D78).
 */
export async function resolveModel(
  athletePath: string,
  requested: string | undefined,
  gateway?: GatewayName,
): Promise<{ gateway: GatewayName; model: string; models: CatalogModel[] }> {
  const { gateway: used, models } = await loadCatalog(gateway);
  const chosen = requested?.trim() || readDefaultModel(athletePath);
  if (!chosen) {
    throw new PredictRefusal(noModelMessage());
  }
  return { gateway: used, model: requireOnList(chosen, models), models };
}

export function requireOnList(id: string, models: CatalogModel[]): string {
  const exact = models.find((m) => m.id === id);
  if (exact) return exact.id;
  const ignoreCase = models.find((m) => m.id.toLowerCase() === id.toLowerCase());
  if (ignoreCase) return ignoreCase.id;
  const close = closestModelIds(id, models);
  throw new PredictRefusal(
    `no model called '${id}' on the live list of text models that can reason.` +
      (close.length > 0 ? ` Closest: ${close.join(", ")}.` : "") +
      ` See them all with \`ath models\`.`,
  );
}

export function noModelMessage(): string {
  return [
    `No model chosen. Pick one for this run:`,
    ``,
    `  ath models`,
    `  ath predict <benchmark> --model <name>`,
    ``,
    `Or save your usual model:`,
    ``,
    `  ath models --default <name>`,
  ].join("\n");
}

export function renderModelList(models: CatalogModel[], gateway: GatewayName): string {
  const lines = [
    `${models.length} live text models that can reason, from ${gateway}.`,
    `Open weights are included. Image, audio, and embedding models are out.`,
    ``,
  ];
  for (const m of models) {
    lines.push(m.name && m.name !== m.id ? `  ${m.id}  (${m.name})` : `  ${m.id}`);
  }
  if (models.length === 0) {
    lines.push(`  (none — the catalog marked no reasoning text models)`);
  }
  lines.push(``);
  lines.push(`Pick one:  ath predict fran --model <name>`);
  lines.push(`Save one:  ath models --default <name>`);
  return lines.join("\n");
}
