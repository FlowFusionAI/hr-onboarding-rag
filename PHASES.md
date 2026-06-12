# Development Journal

This file documents the build progression phase by phase: decisions made, what was built, results measured. Written so a reader can follow the engineering process from blank folder to deployed system.

---

## Phase 1 — Foundation: Documents, Golden Set, and Eval Harness
**Date completed:** 2026-06-12  
**Status:** ✅ Complete

### What was built

Before writing any RAG code, the eval harness was built first. This is intentional — it is the engineering equivalent of writing tests before implementation. Having a measurable definition of "working" before building the system prevents post-hoc rationalisation ("it seems to work") and forces clarity on what the system actually needs to do.

**Three synthetic HR documents generated:**

| File | Contents | Word count |
|------|----------|------------|
| `docs/employee-handbook.md` | 14 sections: leave, sick leave, probation, benefits, expenses, conduct, IT policy, offboarding | ~2,800 words |
| `docs/onboarding-checklist.md` | Day 1 through Day 90 tasks, key contacts table, IT portal links | ~1,200 words |
| `docs/role-faqs.md` | 25 Q&As covering payroll, equipment, leave, remote work, working arrangements | ~1,100 words |

Synthetic documents were chosen over real ones deliberately: controllable content means golden eval answers are unambiguous, and there are no privacy concerns in a public demo.

**Golden evaluation set — `eval/golden-set.json`:**

30 question–answer pairs across 14 categories, structured in three difficulty tiers:

| Tier | Count | Example | What it tests |
|------|-------|---------|---------------|
| Easy | 15 | "How many days annual leave do I get?" | Direct single-section retrieval |
| Medium | 10 | "When does enhanced sick pay apply?" | Conditional answer requiring context from two sections |
| Hard | 5 | "Can I work compressed hours in my first month?" | Multi-hop: probation rules + compressed hours policy must both be retrieved |

Hard questions matter because a RAG that only answers easy questions is not production-ready. If retrieval returns a correct chunk for the wrong section, the model will give a plausible but incorrect answer — and only the multi-hop questions surface this.

**Eval harness — `eval/eval.mjs`:**

A Node.js script that automates scoring. For each question it:

1. Calls the RAG endpoint (or a mock answer generator in `--mock` mode)
2. Makes a second OpenAI call using `gpt-4o-mini` as a judge with a structured JSON output prompt
3. Scores two dimensions independently:
   - **Accuracy (1–5):** does the answer match the expected answer?
   - **Groundedness (1–5):** is every claim in the answer traceable to a retrieved chunk?
4. Prints a summary table and saves `eval/results-{timestamp}.json`

Two dimensions are necessary. Accuracy alone misses hallucination: a model can produce the correct answer from training data without retrieving anything, which fails in production when the documents change. Groundedness alone misses factual errors: the right chunk can be retrieved but misread. Both must be high for the system to be trustworthy.

---

### Phase 1 Eval Results (mock mode baseline)

**Run date:** 2026-06-12  
**Mode:** Mock (no real RAG — the eval machinery itself is under test)

| Metric | Score |
|--------|-------|
| Questions run | 30 / 30 |
| Pass rate | 17% (5/30) |
| Avg accuracy | 1.73 / 5 |
| Avg groundedness | 2.07 / 5 |

**Why these numbers are correct and expected:**

Mock mode uses a hand-coded answer generator that only handles ~8 specific questions. Everything else returns `"Please check your contract or contact HR for more information."` — a non-answer that the judge correctly scores 1/1 every time.

The purpose of this run was not to measure the RAG (which does not exist yet) but to validate that:
- The eval loop runs end-to-end without errors
- The judge distinguishes good answers from bad ones
- The scoring logic catches the specific failure patterns that matter in production

The mock run confirmed all three. Two results are worth calling out:

**Q05 — "What do I need to do on my first day of sickness?"**  
Mock answer: *"Send an email to your manager."*  
Expected answer: *"Call or message your manager — do not just send an email."*  
Result: **A:2 G:5**  
The source chunk was retrieved correctly (groundedness high), but the model stated the wrong fact — the exact opposite of the policy. The judge caught this distinction. This is the most dangerous RAG failure mode in production: the right chunk retrieved, wrong conclusion drawn.

**Q08 — "How much does BrightPath contribute to my pension?"**  
Mock answer: *"BrightPath contributes 4%."*  
Expected answer: *"5% of qualifying earnings."*  
Result: **A:2 G:5**  
Same pattern: correct retrieval, wrong number (4% vs 5%). The eval harness will surface this type of off-by-one factual error reliably.

**Category breakdown:**

| Category | n | Avg accuracy | Avg groundedness |
|----------|---|-------------|-----------------|
| expenses | 1 | 4.0 | 5.0 |
| leave | 6 | 1.7 | 1.8 |
| probation | 2 | 2.5 | 3.0 |
| benefits | 5 | 2.2 | 2.8 |
| payroll | 3 | 1.0 | 1.0 |
| remote-work | 3 | 2.0 | 2.0 |
| working-hours | 2 | 1.0 | 1.0 |

---

### Target baseline for Phase 4 (live RAG)

| Metric | Mock baseline | Target (live RAG) |
|--------|--------------|-------------------|
| Pass rate | 17% | ≥ 80% |
| Avg accuracy | 1.73 / 5 | ≥ 4.0 / 5 |
| Avg groundedness | 2.07 / 5 | ≥ 4.0 / 5 |

If live eval falls below 80% pass rate, the likely causes are: chunk size too large (retrieval returns noisy context), system prompt not constraining the model tightly enough to the retrieved chunks, or the embedding model not capturing semantic similarity for HR-domain terminology.

---

## Phase 2 — Supabase Setup + Ingestion Script
**Status:** 🔜 Not started

**Goal:** Get the three HR documents into a vector database. A question asked in plain English should return the most relevant paragraph from the handbook.

**What will be built:**
- `ingest.mjs` — reads each markdown file, splits into overlapping chunks (~400 tokens, 50-token overlap), embeds with `text-embedding-3-small`, upserts into a Supabase `documents` table with pgvector
- `test-retrieval.mjs` — embeds a test question, runs a cosine similarity search, prints the top 3 retrieved chunks so retrieval quality can be checked before adding generation
- `.env.example` — documents required environment variables

**Key decision to record here after Phase 2:** chunk size and overlap values, and the results of manual retrieval spot checks on 5–10 questions from the golden set.

---

## Phase 3 — n8n RAG Flow
**Status:** 🔜 Not started

**Goal:** Wire retrieval and generation together into a working chat endpoint that the eval harness can call.

**Node sequence to be built in n8n:**
1. Webhook — receives `{ question, session_id }`
2. Embed question via OpenAI embeddings API
3. Vector similarity search in Supabase (top 3 chunks)
4. Build prompt: system instructions + retrieved chunks + question
5. OpenAI GPT-4o-mini — generate answer with inline citations
6. Insert chat turn into Supabase `chat_history` table
7. Return `{ answer, sources, session_id }`

**Key decision to record here after Phase 3:** the system prompt used, whether citations were returned inline or as a separate `sources` array, and whether the response schema matched what `eval.mjs` expects.

---

## Phase 4 — Live Eval Run
**Status:** 🔜 Not started

**Goal:** Run `npm run eval:live` against the real n8n webhook. Measure actual accuracy and groundedness. Record results here.

**Results will be recorded here** once run. These become the CV proof point and the demo UI metric.

---

## Phase 5 — Chat UI + Deploy
**Status:** 🔜 Not started

**Goal:** Public demo accessible to a recruiter in under 30 seconds, no signup.

- Next.js route `/assistant` in Demo Hub
- Suggested question chips (so recruiters know what to ask without needing to read the docs)
- `/assistant/eval` page showing the latest eval results table
- Deploy: Vercel (frontend) + Supabase cloud + n8n on Render free tier
