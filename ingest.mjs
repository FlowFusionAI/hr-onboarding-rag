import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const DOCS_DIR = './hr-docs';
const CHUNK_CHARS = 1600;  // ~400 tokens (1 token ≈ 4 chars)
const OVERLAP_CHARS = 200; // ~50 tokens

// ─── Chunking ────────────────────────────────────────────────────────────────

function chunkText(text) {
  // Split on blank lines to keep paragraphs together.
  // Then accumulate paragraphs until we hit the char budget.
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length > CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: carry the tail of the current chunk into the next one
      const overlap = current.slice(-OVERLAP_CHARS);
      current = overlap + '\n\n' + para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// ─── Embedding ───────────────────────────────────────────────────────────────

async function embedBatch(texts) {
  // OpenAI allows up to 2048 inputs per request; our batches are small
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

// ─── Ingest one file ─────────────────────────────────────────────────────────

async function ingestFile(filePath) {
  const filename = basename(filePath);
  console.log(`\nReading ${filePath}...`);

  const text = readFileSync(filePath, 'utf-8');

  // Extract a rough section name from the first heading
  const firstHeading = text.match(/^#+ (.+)/m)?.[1] ?? filename;

  const chunks = chunkText(text);
  console.log(`  Split into ${chunks.length} chunks`);

  // Delete existing rows for this file so re-runs don't duplicate
  const { error: deleteError } = await supabase
    .from('documents')
    .delete()
    .eq('source_file', filename);
  if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

  // Embed all chunks in one API call
  process.stdout.write('  Embedding chunks...');
  const embeddings = await embedBatch(chunks);
  console.log(' done');

  // Build the rows to insert
  const rows = chunks.map((content, i) => ({
    content,
    embedding: embeddings[i],
    source_file: filename,
    section: firstHeading,
  }));

  const { error: insertError } = await supabase.from('documents').insert(rows);
  if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

  console.log(`  Upserted ${rows.length} rows → documents`);
  return rows.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => join(DOCS_DIR, f));

  if (files.length === 0) {
    console.error('No .md files found in', DOCS_DIR);
    process.exit(1);
  }

  let total = 0;
  for (const file of files) {
    total += await ingestFile(file);
  }

  // Rough cost estimate: text-embedding-3-small = $0.02 per 1M tokens
  const approxTokens = total * 400;
  const approxCost = (approxTokens / 1_000_000) * 0.02;

  console.log(`\nIngestion complete. ${total} total chunks stored.`);
  console.log(`Estimated cost: $${approxCost.toFixed(4)}`);
}

main().catch(err => {
  console.error('\nIngestion failed:', err.message);
  process.exit(1);
});
