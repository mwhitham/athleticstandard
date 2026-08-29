/**
 * Generates schema/athleticstandard.schema.json from the Zod schemas.
 * The Zod definitions in src/schema.ts are the source of truth; run
 * `pnpm generate:json-schema` after any schema change and commit the result.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AthleticStandardFile, ATHLETIC_STANDARD_VERSION } from "../src/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const jsonSchema = z.toJSONSchema(AthleticStandardFile, {
  target: "draft-2020-12",
  io: "input",
  unrepresentable: "any",
});

const out = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://raw.githubusercontent.com/mwhitham/athleticstandard/main/schema/athleticstandard.schema.json`,
  title: "Athletic Standard file",
  ...jsonSchema,
};

mkdirSync(join(root, "schema"), { recursive: true });
writeFileSync(join(root, "schema", "athleticstandard.schema.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote schema/athleticstandard.schema.json");
