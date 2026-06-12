# Phase 1 — Foundation

**Completed:** 2026-06-12  
**Goal:** Build the evaluation infrastructure before building the system it measures.

---

## Approach

I built the eval harness before writing any retrieval or generation code. This is the engineering equivalent of writing tests before implementation: it defines what "working" means before there is anything to test, and prevents post-hoc rationalisation ("it seems to work") from substituting for measurement.

By the end of Phase 1, it is possible to run the full eval loop — question in, score out — even though the RAG system does not exist yet. Phase 2 and 3 slot in underneath without changing the eval interface.

---

## What was built

### Synthetic HR documents

Three markdown documents that serve as the knowledge base for the assistant. I generated these synthetically rather than using real company documents for two reasons: the content is fully controlled (making golden eval answers unambiguous), and there are no privacy concerns in a public demo.

The fictional company is BrightPath Technologies, a UK-based software consultancy. UK labour law specifics were included (SSP rates, HMRC advisory mileage rates, P45/Starter Checklist, AGG-adjacent conduct language) to make the documents realistic enough to test HR-domain retrieval.

| File | Contents | Approx. length |
|------|----------|---------------|
| `hr-docs/employee-handbook.md` | 14 sections: leave, sick leave, probation, benefits, expenses, remote work, conduct, IT security, offboarding | ~2,800 words |
| `hr-docs/onboarding-checklist.md` | Day 1 tasks, Week 1 tasks, 30/60/90-day checkpoints, key contacts, IT portal links | ~1,200 words |
| `hr-docs/role-faqs.md` | 25 Q&As across payroll, equipment, working arrangements, leave, benefits, probation | ~1,100 words |

**Design decision:** Dense, specific content was prioritised over general prose. Vague policies ("we support flexible working") cannot be retrieved and answered precisely — there is nothing to retrieve. Specific facts (25 days leave, 30-day expense deadline, £1,000 learning budget, 10:00–16:00 core hours) produce retrievable, scorable answers and allow the eval to detect off-by-one errors.

### 30-question golden eval set

`eval/golden-set.json` contains 30 questions structured across three difficulty tiers and 14 categories. Each question has:

- `question` — the text sent to the RAG
- `expected_answer` — the correct answer derived from the HR documents
- `source_doc` — which document contains the answer
- `source_section` — which section of that document
- `difficulty` — easy / medium / hard
- `category` — topical grouping for breakdown reporting

The three difficulty tiers test different retrieval failure modes:

- **Easy (15 questions):** The answer is in one paragraph of one document. Failure here means basic retrieval is broken.
- **Medium (10 questions):** The answer depends on a condition stated elsewhere — e.g. "enhanced sick pay applies only after probation is passed" requires both the sick leave section and the probation section. Failure here means retrieval returns insufficient context.
- **Hard (5 questions):** The correct answer requires combining facts from two or more sections simultaneously — e.g. "Can I work compressed hours in my first month?" requires knowing both that compressed hours require probation to be passed (Section 2) and that probation lasts 3 months (Section 7). Failure here means retrieval precision is insufficient.

### Eval harness

`eval/eval.mjs` is a Node.js script that:

1. Loads `golden-set.json`
2. For each question, calls the RAG endpoint (or mock generator in `--mock` mode)
3. Makes a second OpenAI call with `gpt-4o-mini` as a judge, receiving structured JSON with accuracy and groundedness scores
4. Prints a summary table with per-question emoji indicators and category breakdown
5. Optionally saves `eval/results-{timestamp}.json`

The script supports two modes:
- `--mock` — uses a hand-coded answer generator instead of calling a real RAG endpoint. Used to validate the eval machinery before the RAG is built.
- live mode (default) — calls the URL specified in the `RAG_URL` environment variable.

---

## Mock baseline run

The mock baseline was run immediately after Phase 1 was complete. Results: 17% pass rate, avg accuracy 1.73/5, avg groundedness 2.07/5.

These numbers confirmed the eval harness functions correctly. The mock generator only handles ~8 questions — the rest return a non-answer that the judge correctly scores 1/1. Two results were particularly informative:

- **Q08 (pension %):** Mock said 4%, correct is 5%. The judge scored A:2, G:5 — factual error caught despite grounded retrieval.
- **Q05 (sick day):** Mock said "send an email", policy says "call — do not just send an email". Same pattern: A:2, G:5.

Both demonstrate the eval harness detecting the exact failure mode it was designed to catch: correct chunk retrieved, wrong fact stated.

Full results: [docs/eval-results.md](eval-results.md)

---

## Files created in Phase 1

```
hr-docs/
├── employee-handbook.md
├── onboarding-checklist.md
└── role-faqs.md

eval/
├── golden-set.json
├── eval.mjs
└── results-2026-06-12T15-37-38.json

docs/
├── architecture.md
├── eval-methodology.md
├── eval-results.md
└── phase-1-foundation.md   ← this file

.env.example
.gitignore
package.json
README.md
```
