import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const question = process.argv[2];

if (!question) {
  console.error('Usage: node test-retrieval.mjs "your question here"');
  process.exit(1);
}

async function main() {
  console.log(`\nQuery: ${question}\n`);

  // 1. Embed the question using the same model used during ingestion
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question,
  });
  const queryEmbedding = response.data[0].embedding;

  // 2. Call the match_documents RPC — returns the 3 closest chunks
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_count: 3,
  });

  if (error) throw new Error(`RPC failed: ${error.message}`);
  if (!data || data.length === 0) {
    console.log('No results returned. Did ingest.mjs run successfully?');
    return;
  }

  for (let i = 0; i < data.length; i++) {
    const { content, source_file, section, similarity } = data[i];
    console.log(`Rank ${i + 1} (similarity: ${similarity.toFixed(3)}) — ${source_file} § ${section}`);
    // Show a preview of the chunk (first 300 chars)
    console.log(content.slice(0, 300) + (content.length > 300 ? '...' : ''));
    console.log();
  }
}

main().catch(err => {
  console.error('Retrieval failed:', err.message);
  process.exit(1);
});
