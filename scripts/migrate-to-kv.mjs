#!/usr/bin/env node
/**
 * migrate-to-kv.mjs
 *
 * Reads the four JSON data files from the VPS and writes them into
 * Cloudflare KV using the Wrangler CLI.
 *
 * Prerequisites:
 *   1. wrangler installed:  npm install -g wrangler  OR  npx wrangler
 *   2. wrangler authenticated:  npx wrangler login
 *   3. KV namespace created + ID in worker/wrangler.toml
 *   4. VPS JSON files downloaded locally (see instructions below)
 *
 * Run from the repo root:
 *   node scripts/migrate-to-kv.mjs
 *
 * ── To download the VPS JSON files first ───────────────────────────
 *   ssh root@82.25.109.82 'cat /var/www/sharing/uploads/metadata.json'    > uploads/metadata.json
 *   ssh root@82.25.109.82 'cat /var/www/sharing/uploads/share-links.json' > uploads/share-links.json
 *   ssh root@82.25.109.82 'cat /var/www/sharing/uploads/folders.json'     > uploads/folders.json
 *   ssh root@82.25.109.82 'cat /var/www/sharing/uploads/folder-meta.json' 2>/dev/null > uploads/folder-meta.json || echo '{}' > uploads/folder-meta.json
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir  = dirname(fileURLToPath(import.meta.url));
const root   = resolve(__dir, "..");
const KV_ID  = process.env.KV_ID || readKvIdFromToml();

function readKvIdFromToml() {
  const toml = resolve(root, "worker/wrangler.toml");
  if (!existsSync(toml)) return null;
  const match = readFileSync(toml, "utf8").match(/id\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

if (!KV_ID || KV_ID === "REPLACE_WITH_YOUR_KV_NAMESPACE_ID") {
  console.error(
    "❌  KV namespace ID not set.\n" +
    "    Run:  npx wrangler kv namespace create METADATA\n" +
    "    Then copy the ID into worker/wrangler.toml\n" +
    "    Or:   KV_ID=xxx node scripts/migrate-to-kv.mjs"
  );
  process.exit(1);
}

const mappings = [
  { file: "metadata.json",    key: "db:metadata",     default: "[]" },
  { file: "share-links.json", key: "db:share-links",  default: "[]" },
  { file: "folders.json",     key: "db:folders",      default: '["General"]' },
  { file: "folder-meta.json", key: "db:folder-meta",  default: "{}" }
];

console.log(`\n📦  Migrating JSON data → Cloudflare KV  (namespace: ${KV_ID})\n`);

for (const { file, key, default: fallback } of mappings) {
  const filePath = resolve(root, "uploads", file);
  let value;

  if (existsSync(filePath)) {
    value = readFileSync(filePath, "utf8").trim();
    if (!value) value = fallback;
    console.log(`  ✔  ${file} → KV key "${key}"`);
  } else {
    value = fallback;
    console.log(`  ⚠  ${file} not found — writing default ${fallback} → KV key "${key}"`);
  }

  // Write via wrangler CLI (base64-safe — wrangler reads from stdin or --value)
  const escaped = value.replace(/'/g, "'\\''");
  execSync(
    `npx wrangler kv key put --namespace-id="${KV_ID}" "${key}" '${escaped}'`,
    { stdio: "inherit", cwd: resolve(root, "worker") }
  );
}

console.log("\n✅  Migration complete!\n");
