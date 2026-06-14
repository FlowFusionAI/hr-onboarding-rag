/**
 * Reproduces what the n8n Retrieval node sends, two ways, against your real data.
 * Run with the same env as ingest.mjs:
 *   node verify-query-format.mjs
 *
 * For two DIFFERENT questions it calls match_documents with the query embedding:
 *   (A) as a numeric array      — what n8n SHOULD send
 *   (B) as a stringified vector — what `'[' + embedding.join(',') + ']'` produces
 *
 * If (A) returns different, relevant rows per question but (B) returns the SAME
 * rows for both (or errors), the bug is the string formatting in the query path.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const questions = [
  'How many days of annual leave do I get per year?',
  'How long is the probation period?',
];

const embed = async (q) =>
  (await openai.embeddings.create({ model: 'text-embedding-3-small', input: q })).data[0].embedding;

const show = (r) =>
  r.error ? `ERROR: ${r.error.message}` : JSON.stringify(r.data.map((x) => x.id ?? (x.content || '').slice(0, 30)));

for (const q of questions) {
  const e = await embed(q);
  const asArray = e;                         // (A) numeric array
  const asString = '[' + e.join(',') + ']';  // (B) stringified, like Format Vector

  const a = await supabase.rpc('match_documents', { query_embedding: asArray, match_count: 3 });
  const b = await supabase.rpc('match_documents', { query_embedding: asString, match_count: 3 });

  console.log(`\nQ: ${q}`);
  console.log(`  (A) array  -> ${show(a)}`);
  console.log(`  (B) string -> ${show(b)}`);
}

console.log('\nIf (A) varies by question but (B) is constant/errors, the fix is to send an array, not a string.');
