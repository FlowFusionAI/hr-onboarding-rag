/**
 * Localises the constant-retrieval bug. Run with the same env as ingest.mjs:
 *   node verify-supabase.mjs
 *
 * It answers two questions:
 *   1. Are the stored embeddings actually present and distinct? (null/identical => storage bug)
 *   2. Does match_documents respond differently to two different query vectors?
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── 1. Inspect stored embeddings ────────────────────────────────────────────
const { data: rows, error } = await supabase
  .from('documents')
  .select('id, source_file, embedding')
  .limit(3);

if (error) { console.error('SELECT failed:', error.message); process.exit(1); }

console.log(`\nFetched ${rows.length} rows.`);
for (const r of rows) {
  const e = r.embedding;
  let len = null;
  if (typeof e === 'string') { try { len = JSON.parse(e).length; } catch {} }
  else if (Array.isArray(e)) len = e.length;
  console.log(`  id=${r.id}  file=${r.source_file}  embedding: ${e == null ? 'NULL ❌' : `type=${typeof e} dims=${len}`}`);
}

if (rows.length >= 2) {
  const a = JSON.stringify(rows[0].embedding);
  const b = JSON.stringify(rows[1].embedding);
  console.log(`\n  Two rows have ${a === b ? 'IDENTICAL ❌' : 'DIFFERENT ✅'} embeddings.`);
}

// ── 2. Does retrieval respond to the query vector? ──────────────────────────
const rnd = (n) => Array.from({ length: n }, () => Math.random() * 2 - 1);

const results = {};
for (const tag of ['probeA', 'probeB']) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: rnd(1536),
    match_count: 3,
  });
  if (error) { console.log(`\n  ${tag} rpc error: ${error.message}`); continue; }
  results[tag] = (data || []).map((d) => d.id ?? (d.content || '').slice(0, 25));
  console.log(`\n  ${tag} -> ${JSON.stringify(results[tag])}`);
}

if (results.probeA && results.probeB) {
  const same = JSON.stringify(results.probeA) === JSON.stringify(results.probeB);
  console.log(`\n  Two different query vectors returned ${same ? 'THE SAME rows ❌ (retrieval is not discriminating)' : 'DIFFERENT rows ✅'}`);
}
