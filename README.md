# HR Onboarding RAG Assistant

An AI-powered assistant that answers new-hire questions from company documents, with a published evaluation harness measuring answer quality.

**Status:** Phase 1 complete — eval harness built and validated in mock mode  
**Demo:** Coming — `/assistant` route on Demo Hub  
**Stack:** n8n · OpenAI · Supabase (pgvector) · Next.js

---

## What it does

A new employee types: *"When does my private health insurance start?"*

The assistant:
1. Converts the question to a vector embedding
2. Searches the employee handbook in Supabase for the most relevant passages
3. Passes those passages + the question to GPT to generate a grounded answer
4. Returns the answer with citations ("Source: Employee Handbook, Section 9")

The key differentiator: the system comes with a **published eval harness** — an automated test suite that measures how accurate and grounded the answers are across 30 questions. Most RAG demos skip this. Having measured results (e.g. "87% grounded answers") is what separates "built a chatbot" from "built a production-ready AI system."

---

## Architecture

```
User question
    │
    ▼
n8n Webhook (POST /webhook/rag-chat)
    │
    ├─ Embed question (text-embedding-3-small)
    │
    ├─ Supabase vector search → top 3 chunks
    │
    ├─ Build prompt: system + chunks + question
    │
    ├─ OpenAI GPT-4o-mini → answer with citations
    │
    └─ Save turn to chat_history table
    │
    ▼
Response: { answer, sources, session_id }
```

**Eval harness (separate):**
```
golden-set.json (30 Q&A pairs)
    │
    ▼
eval.mjs
    ├─ Calls RAG for each question
    ├─ Calls GPT-4o-mini as judge (accuracy + groundedness)
    └─ Prints summary table + saves results-{timestamp}.json
```

---

## Project Phases

### Phase 1 — Docs + Eval Harness ✅ Complete

**What was built:**
- `docs/employee-handbook.md` — 14-section synthetic HR handbook (leave, expenses, benefits, conduct, IT policy, offboarding)
- `docs/onboarding-checklist.md` — Day 1 through Day 90 checklist with key contacts
- `docs/role-faqs.md` — 25 common new-hire Q&As covering payroll, equipment, leave, remote work
- `eval/golden-set.json` — 30 questions across 14 categories (easy/medium/hard difficulty tiers)
- `eval/eval.mjs` — automated eval harness: calls RAG, calls judge LLM, prints summary table

**How to run (mock mode — no RAG needed):**
```powershell
cd "C:\Users\saura\Desktop\Personal\Projects\Before 2026\Demo RAG Chatbot"
$env:OPENAI_API_KEY = "sk-proj-..."
npm run eval:mock
```

**Mock mode baseline results (2026-06-12):**
| Metric | Score | Note |
|--------|-------|------|
| Pass rate | 17% (5/30) | Expected — mock answers are intentionally incomplete |
| Avg accuracy | 1.73 / 5 | Most questions fall back to "check with HR" |
| Avg groundedness | 2.07 / 5 | No real RAG retrieval yet |

These low scores are the **correct baseline**. The eval harness is confirmed working:
- Correctly scores right answers high (Q14 learning budget: A:5 G:5)
- Correctly catches factual errors even when retrieval is good (Q08 pension %: A:2 G:5 — mock said 4%, correct is 5%)
- Correctly scores "no answer" as 1/1

**Target after real RAG is built:** Pass rate ≥ 80%, avg accuracy ≥ 4.0, avg groundedness ≥ 4.0

---

### Phase 2 — Supabase Setup + Ingestion Script 🔜 Next

**Goal:** Get the HR docs into a vector database so the RAG can retrieve relevant chunks.

**What to build:**
- Supabase project (free tier) with pgvector extension enabled
- `ingest.mjs` — reads the three HR docs, splits into chunks, embeds with `text-embedding-3-small`, upserts into Supabase
- A test query: embed a question, run a similarity search, confirm the right chunk comes back

**Cost estimate:** ~$0.001 (one-time embedding of ~5,000 tokens)

**Outcome:** You can type a question into a script and see the relevant document passage appear. No LLM generation yet — just retrieval.

**Files to create:**
```
ingest.mjs          ← chunk + embed + upsert
test-retrieval.mjs  ← embed a question, print top 3 chunks
.env.example        ← template for SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY
```

---

### Phase 3 — n8n RAG Flow 🔜

**Goal:** Wire together retrieval + generation into a working chat endpoint.

**What to build:**
- n8n workflow: webhook → embed → vector search → prompt → OpenAI → respond
- Chat history table in Supabase (for multi-turn memory)
- The webhook returns `{ answer, sources, session_id }`

**n8n node sequence:**
1. **Webhook** — receives `{ question, session_id }`
2. **Code node** — calls OpenAI embeddings API, returns `[0.123, -0.456, ...]`
3. **Supabase node** — runs `match_documents(embedding, 3)` RPC
4. **Code node** — builds the system prompt with retrieved chunks
5. **OpenAI Chat** — generates the answer
6. **Supabase node** — inserts turn into `chat_history`
7. **Respond to Webhook** — returns `{ answer, sources }`

**Cost estimate per query:** ~$0.0003 (embeddings) + ~$0.001 (generation at gpt-4o-mini rates) = < $0.002

---

### Phase 4 — Live Eval Run 🔜

**Goal:** Run the eval harness against the real RAG and measure actual performance.

**How to run:**
```powershell
$env:OPENAI_API_KEY = "sk-proj-..."
$env:RAG_URL = "https://your-n8n-instance/webhook/rag-chat"
npm run eval:live
```

**What to check:**
- Pass rate should jump from 17% (mock baseline) to ≥ 80%
- Any question scoring < 4 on accuracy = retrieval or prompt issue to fix
- Any question scoring < 4 on groundedness = model is going off-script, tighten the system prompt

**What the results become:** The real numbers (e.g. "87% grounded answers on 30-question golden set") go into the README, the CV bullet, and the demo UI. These are your proof point.

---

### Phase 5 — Chat UI + Deploy 🔜

**Goal:** A publicly accessible demo with a chat interface and an eval results page.

**What to build:**
- Next.js route `/assistant` in Demo Hub — chat interface with suggested-question chips
- `/assistant/eval` page — table of eval results from the latest `results-{timestamp}.json`
- Deploy: Vercel (frontend) + Supabase cloud (already cloud-native) + n8n on Render free tier

**Cost to run the demo:** $0/month at low traffic (all free tiers)

---

## Eval Methodology

### Scoring dimensions

| Dimension | Question it answers | Score 1 | Score 5 |
|-----------|-------------------|---------|---------|
| **Accuracy** | Is the answer factually correct vs the expected answer? | Completely wrong or refuses | Correct and complete |
| **Groundedness** | Is every claim traceable to a retrieved document chunk? | Pure hallucination — no chunks used | Every claim is in the chunks |

### Why both matter

- High accuracy + low groundedness = the model got lucky (training data, not your docs). Won't scale to new policies.
- High groundedness + low accuracy = retrieved the wrong chunk, or misread it. A retrieval/prompt issue.
- Both high = working as intended.

### Golden set design

30 questions across 3 difficulty tiers:

| Tier | # Qs | Example | Why it's in the set |
|------|------|---------|---------------------|
| Easy | 15 | "How many days annual leave?" | Confirms basic retrieval works |
| Medium | 10 | "When does enhanced sick pay apply?" | Tests conditional retrieval (answer depends on another policy) |
| Hard | 5 | "Can I work compressed hours in month 1?" | Multi-section reasoning: probation rules + compressed hours rules must both be retrieved |

### Re-running the eval

Run after every change to the system prompt, chunking strategy, or embedding model. Save each run's output — the `results-{timestamp}.json` files form a history of how performance changes over time.

---

## File Structure

```
Demo RAG Chatbot/
├── docs/
│   ├── employee-handbook.md       ← BrightPath Technologies handbook (synthetic)
│   ├── onboarding-checklist.md    ← Day 1–90 tasks and key contacts
│   └── role-faqs.md               ← 25 common new-hire Q&As
├── eval/
│   ├── golden-set.json            ← 30 Q&A pairs (the test suite)
│   ├── eval.mjs                   ← Eval harness script
│   └── results-*.json             ← Saved eval runs (gitignored)
├── package.json
└── README.md
```

Phases 2–5 will add: `ingest.mjs`, `test-retrieval.mjs`, `.env.example`, and the Next.js UI.

---

## CV Bullet (draft — update with real numbers after Phase 4)

> Built and deployed a RAG onboarding assistant (n8n, pgvector/Supabase, OpenAI) that answers new-hire questions over company documents with grounded citations; published an evaluation harness measuring answer accuracy and groundedness on a 30-question golden set — **[X]% grounded answers, [Y]% pass rate**.

---

## Cost Summary

| Component | Provider | Cost |
|-----------|----------|------|
| Vector embeddings (one-time ingest) | OpenAI text-embedding-3-small | ~$0.001 |
| Eval run (30 questions × judge call) | OpenAI gpt-4o-mini | ~$0.01 per run |
| Per chat query (embed + generate) | OpenAI | ~$0.002 |
| Database + vector search | Supabase free tier | $0 |
| Workflow engine | n8n (self-hosted on Render free tier) | $0 |
| Frontend | Vercel free tier | $0 |
| **Total demo cost** | | **~$0/month at low traffic** |
