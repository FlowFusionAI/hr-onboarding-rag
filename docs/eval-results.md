# Evaluation Results

All eval runs are recorded here in reverse chronological order. Each run links to the full JSON output in `eval/`.

---

## Run 1 — Phase 1 Mock Baseline

**Date:** 2026-06-12  
**Mode:** Mock (no live RAG — the eval harness itself is under test)  
**Full output:** [eval/results-2026-06-12T15-37-38.json](../eval/results-2026-06-12T15-37-38.json)

### Summary

| Metric | Result |
|--------|--------|
| Questions run | 30 / 30 |
| Pass rate | 17% (5 / 30) |
| Avg accuracy | 1.73 / 5 |
| Avg groundedness | 2.07 / 5 |

### What mock mode does

The mock generator has specific answers coded for 8 questions. Everything else returns: *"Please check your contract or contact HR for more information."* The judge scores this non-answer as 1/1 every time. The 17% pass rate reflects those 8 partially-correct mock answers — not any retrieval quality.

The purpose of this run was to validate that the evaluation machinery functions correctly before the retrieval system is built. Running it confirmed three things:

1. The eval loop runs end-to-end without errors across all 30 questions.
2. The judge produces meaningful score differentiation — high scores for correct answers, low scores for non-answers, and intermediate scores for partial answers.
3. The two dimensions behave independently, catching different failure modes.

### Notable results

**Q08 — "How much does BrightPath contribute to my pension?"**  
Mock answer: *"BrightPath contributes 4% to your pension."*  
Expected answer: *"5% of qualifying earnings."*  
Result: **A:2, G:5**

The source chunk was retrieved correctly (groundedness high), but the mock stated the wrong figure — 4% instead of 5%. The judge caught the factual error despite the answer being grounded. This is the most dangerous RAG failure mode in production: correct retrieval, wrong conclusion. The eval harness reliably surfaces it.

**Q05 — "What do I need to do on my first day of sickness?"**  
Mock answer: *"Send an email to your manager on the first day of sickness."*  
Expected answer: *"Call or message your manager before your usual start time. Do not just send an email."*  
Result: **A:2, G:5**

Same pattern — grounded but inaccurate. The policy explicitly states the opposite of what the mock answered. The judge flagged the contradiction between the answer and the source chunk.

Both Q05 and Q08 demonstrate that the dual-dimension scoring catches failures that a single accuracy metric would still catch, but with more diagnostic information: the high groundedness score tells you the chunk was retrieved correctly, so the problem is in the generation step (system prompt, model behaviour), not the retrieval step.

### Category breakdown

| Category | n | Avg accuracy | Avg groundedness |
|----------|---|-------------|-----------------|
| expenses | 1 | 4.0 | 5.0 |
| probation | 2 | 2.5 | 3.0 |
| benefits | 5 | 2.2 | 2.8 |
| remote-work | 3 | 2.0 | 2.0 |
| sick-leave | 2 | 1.5 | 3.0 |
| leave | 6 | 1.7 | 1.8 |
| day-1 | 1 | 3.0 | 4.0 |
| conduct | 1 | 1.0 | 1.0 |
| equipment | 1 | 1.0 | 1.0 |
| offboarding | 1 | 1.0 | 1.0 |
| payroll | 3 | 1.0 | 1.0 |
| training | 1 | 1.0 | 1.0 |
| wellbeing | 1 | 1.0 | 1.0 |
| working-hours | 2 | 1.0 | 1.0 |

### Interpretation

The mock generator only has answers for a small subset of questions. Categories where the mock happened to have an answer (expenses, probation) score higher. Categories with no mock answer (payroll, conduct, working-hours) score 1.0 across both dimensions — the correct result for a non-answer.

These scores are not a reflection of the RAG system's capability. They are a confirmation that the eval harness correctly distinguishes correct answers from non-answers.

---

## Runs 2+ — Live RAG (Pending Phase 3)

Live eval results will be recorded here after the n8n RAG flow is built and deployed. The target is:

| Metric | Target |
|--------|--------|
| Pass rate | ≥ 80% |
| Avg accuracy | ≥ 4.0 / 5 |
| Avg groundedness | ≥ 4.0 / 5 |

If the live eval falls below target, the most likely causes are: chunk size too large (noisy context reduces answer precision), system prompt insufficiently constraining the model to retrieved content, or retrieval k too low (the correct chunk is ranked 4th and not returned in the top 3).
