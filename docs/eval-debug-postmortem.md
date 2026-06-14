# Eval Debugging Postmortem

**System:** BrightPath HR onboarding RAG (n8n + Supabase/pgvector + OpenAI), evaluated with a 30-question golden set via `eval.mjs`.  
**Outcome:** Root cause found and fixed. Eval now runs correctly — 97% pass rate, 4.87/5 accuracy and groundedness.

---

## TL;DR

Every one of the 30 eval questions failed with the same refusal answer and the same three retrieved chunks. The database, the `match_documents` SQL, the retrieval formatting, the agent prompt, and the eval harness were **all fine**. The actual bug was a single wrong path in one n8n Code node:

`Extract Question` read `$json.question`, but the n8n Webhook node nests the POSTed payload under `body`. So the real value was at `$json.body.question`. Reading the wrong path returned `undefined`, which meant every question was embedded as an empty string. That produced **one constant query vector** for all 30 questions, which always retrieved the same three (irrelevant) chunks — so the agent correctly answered "I don't have that information" every single time.

**The fix:**

```js
const body = $input.first().json.body ?? $input.first().json;
```

---

## The symptom

Running `eval.mjs` against the published webhook produced:

- **Pass rate:** ~3% (effectively 0 real passes)
- **Avg accuracy:** 1.13 / 5
- **Avg groundedness:** 1.13 / 5

Every question returned the identical answer:

> "I don't have that information in the company documents. Please contact people@brightpath.io."

And — critically — every question returned the **exact same three source chunks**, regardless of what was asked.

The webhook was confirmed live and published, the production URL was correct, and the OpenAI key was valid.

---

## Investigation

The key discipline here was refusing to trust any hypothesis without a probe against the real system. Two strong, plausible hypotheses were tested and **both turned out to be wrong** before the real cause surfaced.

### Step 1 — Confirm the pattern, locate the failure layer

The key observation: all 30 questions returned one distinct source-set — identical three chunks every time. Those three chunks came from three unrelated sections of three different documents (onboarding contacts, season-ticket loan, dress-code FAQ), and several started mid-word.

**Conclusion:** The agent was behaving *correctly*. Its system prompt says to refuse when the answer isn't in the retrieved context, and the context genuinely never contained the answer. The bug was upstream, in **retrieval** — it returned the same irrelevant chunks for every query. The agent, the prompt, and the eval harness were ruled out.

### Step 2 (false lead #1) — "The embeddings were stored wrong"

The leading hypothesis was a classic pgvector mistake: the insert passed a raw JS array into the vector column, which can silently land as `NULL`/degenerate for every row — which would make every row tie on distance and return a constant arbitrary top-3.

A probe (`verify-supabase.mjs`) was written to check the stored data directly.

**Result — hypothesis rejected:**

```
id=51  embedding: type=string dims=1536
id=52  embedding: type=string dims=1536
Two rows have DIFFERENT embeddings.
probeA -> [60,75,53]
probeB -> [56,57,72]
Two different query vectors returned DIFFERENT rows
```

Embeddings were present, 1536-dim, distinct per row, and `match_documents` ordered correctly by distance. **The database and SQL function were healthy.** No re-ingest needed.

### Step 3 (false lead #2) — "The retrieval node sends a string, not a vector"

Refocusing on the n8n query path: the `Format Vector` node builds the embedding as a string (`'[' + embedding.join(',') + ']'`), and the Retrieval node interpolates it in the JSON body. A reasonable theory: n8n renders that as a quoted string (or broken JSON), so `match_documents` receives a non-vector and falls back to constant results.

A probe (`verify-query-format.mjs`) embedded two different real questions and called `match_documents` both ways — as a numeric array **and** as the stringified form — to see if the string form misbehaved.

**Result — hypothesis rejected:**

```
Q: How many days of annual leave do I get per year?
  (A) array  -> [53,69,54]
  (B) string -> [53,69,54]
Q: How long is the probation period?
  (A) array  -> [74,73,66]
  (B) string -> [74,73,66]
```

Both forms returned correct, **different** rows per question. Retrieval works perfectly whenever it is handed a real question embedding. The formatting was not the problem.

### Step 4 — The real cause

The two rejections together were the breakthrough. Retrieval works for *any* valid embedding, yet production returned a constant, semantically-meaningless set. Therefore the **query embedding itself was constant in production** — the `Embed` node was embedding the same thing every call.

The decisive clue from Step 1 reinforced this: the constant three chunks were unrelated fragments and were **not** probation content, even though the pinned test question was about probation. A real text embedding would have pulled a coherent topic cluster. A constant, contentless vector (the embedding of an empty string) pulls an arbitrary fixed set — exactly what was seen.

Tracing back to `Extract Question`:

```js
const body = $input.first().json;   // <-- wrong
question: body.question,            // undefined on live calls
```

n8n's **Webhook node nests the POST payload under `body`** (alongside `headers`, `query`, `params`). The real value lives at `$json.body.question`. Reading `$json.question` returned `undefined`, so every question was embedded as an empty string.

**Why it looked like it worked:** the Webhook node had **pinned data in the flat shape** (`{ question, session_id }` at the top level). Manual test executions use that pin, so `body.question` resolved and everything looked healthy. Only live POSTs from the eval harness arrived in the real nested shape — so the bug appeared exclusively in production.

---

## The fix

In the `Extract Question` node, read from `body` when present and fall back to the flat shape so both pinned tests and live calls work:

```js
const body = $input.first().json.body ?? $input.first().json;

return [{
  json: {
    question: body.question,
    session_id: body.session_id || ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))
  }
}];
```

Nothing else in the workflow needed to change. Once a real question reached the `Embed` node, the rest of the pipeline — which had been proven correct end-to-end — took over.

**Result after fix:** 97% pass rate, 4.87/5 accuracy, 4.87/5 groundedness.

---

## Reusable diagnostic artefacts

Three probe scripts were produced during this investigation:

| Script | What it checks |
|---|---|
| `verify-supabase.mjs` | Are stored embeddings present, correctly typed, distinct, and does `match_documents` discriminate between query vectors? |
| `verify-query-format.mjs` | Does the query embedding behave the same whether passed as an array or as a pgvector text string? |

---

## Lessons

- **A constant, irrelevant retrieval set is a fingerprint** for a null/contentless query vector reaching the vector store — not a similarity-ranking problem.
- **Pinned webhook data masks payload-shape bugs.** A flat pin makes manual runs pass while live calls (real nested `body`) fail. When a webhook "works in test but not in production," suspect the payload path first.
- **Probe before believing.** Two well-reasoned hypotheses (storage, then formatting) were both wrong. Each cheap probe against the real system saved a wasted re-ingest or workflow rewrite and narrowed the search until only the true cause remained.
