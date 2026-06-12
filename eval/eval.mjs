/**
 * HR Onboarding RAG — Eval Harness
 *
 * Runs the golden Q&A set through the RAG system and scores each answer
 * on two dimensions:
 *   - accuracy:     does the answer match the expected answer? (1–5)
 *   - groundedness: is the answer supported by the retrieved chunks? (1–5)
 *
 * Usage:
 *   node eval/eval.mjs                   # runs against RAG_URL env var
 *   node eval/eval.mjs --mock            # uses fake answers (test the eval logic itself)
 *   node eval/eval.mjs --output results  # saves results to eval/results-{timestamp}.json
 *
 * Env vars:
 *   OPENAI_API_KEY  — required for judge calls
 *   RAG_URL         — n8n webhook URL, e.g. https://your-n8n.app.n8n.cloud/webhook/rag-chat
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAG_URL = process.env.RAG_URL;
const MOCK_MODE = process.argv.includes("--mock");
const SAVE_OUTPUT = process.argv.includes("--output");

// Judge model — gpt-4o-mini is fast, cheap, and good enough for structured eval
const JUDGE_MODEL = "gpt-4o-mini";

// Score thresholds for pass/warn/fail display
const SCORE_PASS = 4;
const SCORE_WARN = 3;

// ── Load golden set ───────────────────────────────────────────────────────────

const goldenSet = JSON.parse(
  readFileSync(join(__dir, "golden-set.json"), "utf8")
);

console.log(`\nBrightPath HR RAG — Eval Harness`);
console.log(`Golden set: ${goldenSet.length} questions`);
console.log(`Mode: ${MOCK_MODE ? "MOCK" : "LIVE"}`);
if (!MOCK_MODE && RAG_URL) console.log(`RAG endpoint: ${RAG_URL}`);
console.log("─".repeat(60));

// ── RAG call ──────────────────────────────────────────────────────────────────

/**
 * Calls the RAG endpoint and returns { answer, sources }.
 * In mock mode, returns a plausible but imperfect fake answer so
 * we can test the judge scoring logic without a live RAG.
 */
async function callRAG(question) {
  if (MOCK_MODE) {
    return generateMockAnswer(question);
  }

  if (!RAG_URL) {
    throw new Error("RAG_URL env var is required unless running with --mock");
  }

  const response = await fetch(RAG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, session_id: `eval-${Date.now()}` }),
  });

  if (!response.ok) {
    throw new Error(`RAG endpoint returned ${response.status}`);
  }

  const data = await response.json();

  // Expected response shape from n8n: { answer: string, sources: string[] }
  // Adjust this if your n8n flow returns a different shape
  return {
    answer: data.answer ?? data.text ?? data.output ?? String(data),
    sources: data.sources ?? data.chunks ?? [],
  };
}

// ── Judge call ────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are an expert evaluator for an HR question-answering system.
Your job is to score answers on two dimensions, each 1–5.

ACCURACY (1–5): How well does the RAG answer match the expected answer?
  5 = Correct and complete. Key facts match, nothing important is missing.
  4 = Mostly correct. Minor omissions or slight imprecision but no errors.
  3 = Partially correct. Core fact present but important details missing or imprecise.
  2 = Mostly wrong. Correct direction but significant factual errors.
  1 = Completely wrong or refuses to answer.

GROUNDEDNESS (1–5): Is the RAG answer supported by the provided source chunks?
  5 = Every claim in the answer is directly traceable to a source chunk.
  4 = Most claims are grounded; minor details added from general knowledge.
  3 = Core answer is grounded but some claims are not in the chunks.
  2 = The answer goes significantly beyond or contradicts the chunks.
  1 = The answer is not grounded in the chunks at all (hallucination).

Return a JSON object with this exact structure and nothing else:
{
  "accuracy": <number 1-5>,
  "groundedness": <number 1-5>,
  "accuracy_reasoning": "<one sentence>",
  "groundedness_reasoning": "<one sentence>"
}`;

async function judgeAnswer(question, expectedAnswer, ragAnswer, sources) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY env var is required");
  }

  const sourcesText =
    sources.length > 0
      ? sources.map((s, i) => `[Chunk ${i + 1}]: ${s}`).join("\n\n")
      : "(no sources provided by RAG)";

  const userMessage = `QUESTION: ${question}

EXPECTED ANSWER: ${expectedAnswer}

RAG ANSWER: ${ragAnswer}

SOURCE CHUNKS RETRIEVED:
${sourcesText}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI judge call failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Mock answer generator ─────────────────────────────────────────────────────
// Generates imperfect fake answers so you can test the judge logic before
// the real RAG is built. Deliberately mixes some correct, some vague, some wrong.

function generateMockAnswer(question) {
  const q = question.toLowerCase();

  if (q.includes("annual leave") && q.includes("days")) {
    return {
      answer: "You get 25 days of annual leave per year.",
      sources: [
        "Entitlement: 25 days per year, plus UK public holidays (8 days in England; 9 in Scotland).",
      ],
    };
  }
  if (q.includes("pension") && q.includes("contribute")) {
    return {
      answer: "BrightPath contributes 4% to your pension.",
      sources: [
        "BrightPath contributes 5% of qualifying earnings; the minimum employee contribution is 3%.",
      ],
    };
  }
  if (q.includes("sick") && q.includes("first day")) {
    return {
      answer:
        "Send an email to your manager on the first day of sickness to let them know.",
      sources: [
        "Call or message your line manager before your normal start time on the first day of absence. Do not just send an email — a direct message or call is required.",
      ],
    };
  }
  if (q.includes("probation") && q.includes("how long")) {
    return {
      answer: "The probation period is 3 months.",
      sources: [
        "Duration: 3 months for all new employees. A formal probation review takes place at the end of month 2 and month 3.",
      ],
    };
  }
  if (q.includes("expense") && q.includes("deadline")) {
    return {
      answer:
        "Expenses must be submitted within 30 days of the expense being incurred.",
      sources: [
        "All expense claims must be submitted within 30 days of the expense being incurred. Claims submitted after 30 days will not be reimbursed.",
      ],
    };
  }
  if (q.includes("learning budget")) {
    return {
      answer: "You have a £1,000 annual learning budget for training and certifications.",
      sources: [
        "£1,000 per employee per year for professional development (courses, certifications, conferences). Approved by your line manager.",
      ],
    };
  }
  if (q.includes("access card") && q.includes("first day")) {
    return {
      answer: "Pick up your access card from the IT desk on the ground floor.",
      sources: [
        "London: IT desk, Ground Floor Room G4. Manchester: Reception desk, Level 1. Edinburgh: Facilities office, 2nd floor.",
      ],
    };
  }
  if (q.includes("fully remote")) {
    return {
      answer:
        "You can request to work fully remotely after six months. Requests are reviewed quarterly.",
      sources: [
        "Employees who wish to work fully remotely must submit a formal request to people@brightpath.io. A minimum six-month tenure is required.",
      ],
    };
  }

  // Default: vague answer with no sources (tests low groundedness)
  return {
    answer: "Please check your contract or contact HR for more information on this topic.",
    sources: [],
  };
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function scoreEmoji(score) {
  if (score >= SCORE_PASS) return "✅";
  if (score >= SCORE_WARN) return "⚠️ ";
  return "❌";
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Main eval loop ────────────────────────────────────────────────────────────

async function runEval() {
  const results = [];

  for (let i = 0; i < goldenSet.length; i++) {
    const item = goldenSet[i];
    process.stdout.write(`[${item.id}] ${item.question.substring(0, 60)}… `);

    try {
      const { answer: ragAnswer, sources } = await callRAG(item.question);
      const scores = await judgeAnswer(
        item.question,
        item.expected_answer,
        ragAnswer,
        sources
      );

      const result = {
        ...item,
        rag_answer: ragAnswer,
        sources,
        accuracy: scores.accuracy,
        groundedness: scores.groundedness,
        accuracy_reasoning: scores.accuracy_reasoning,
        groundedness_reasoning: scores.groundedness_reasoning,
        status: scores.accuracy >= SCORE_PASS && scores.groundedness >= SCORE_PASS ? "pass" : "fail",
      };

      results.push(result);

      console.log(
        `A:${scoreEmoji(scores.accuracy)}${scores.accuracy} G:${scoreEmoji(scores.groundedness)}${scores.groundedness}`
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ ...item, error: err.message, status: "error" });
    }

    // Small delay to avoid rate-limit on judge calls
    if (i < goldenSet.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return results;
}

// ── Summary table ─────────────────────────────────────────────────────────────

function printSummary(results) {
  const completed = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const passed = completed.filter((r) => r.status === "pass");

  const accScores = completed.map((r) => r.accuracy);
  const grndScores = completed.map((r) => r.groundedness);

  const avgAcc = avg(accScores).toFixed(2);
  const avgGrnd = avg(grndScores).toFixed(2);
  const passRate = ((passed.length / completed.length) * 100).toFixed(0);

  console.log("\n" + "═".repeat(60));
  console.log("  EVAL RESULTS SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Questions run:     ${completed.length} / ${results.length}`);
  console.log(`  Pass rate:         ${passRate}%  (${passed.length}/${completed.length})`);
  console.log(`  Avg accuracy:      ${avgAcc} / 5`);
  console.log(`  Avg groundedness:  ${avgGrnd} / 5`);
  if (failed.length > 0) console.log(`  Errors:            ${failed.length}`);
  console.log("─".repeat(60));

  // Show failing questions
  const failures = completed.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    console.log("\n  LOW-SCORING QUESTIONS (accuracy < 4 OR groundedness < 4):");
    for (const r of failures) {
      console.log(`\n  [${r.id}] ${r.question}`);
      console.log(`    Accuracy:     ${scoreEmoji(r.accuracy)}${r.accuracy} — ${r.accuracy_reasoning}`);
      console.log(`    Groundedness: ${scoreEmoji(r.groundedness)}${r.groundedness} — ${r.groundedness_reasoning}`);
    }
  }

  console.log("\n" + "═".repeat(60));

  // Category breakdown
  const categories = [...new Set(completed.map((r) => r.category))];
  console.log("\n  BREAKDOWN BY CATEGORY:");
  for (const cat of categories.sort()) {
    const catItems = completed.filter((r) => r.category === cat);
    const catAvgAcc = avg(catItems.map((r) => r.accuracy)).toFixed(1);
    const catAvgGrnd = avg(catItems.map((r) => r.groundedness)).toFixed(1);
    console.log(
      `    ${cat.padEnd(20)} n=${catItems.length}  acc:${catAvgAcc}  grnd:${catAvgGrnd}`
    );
  }

  return { passRate, avgAcc, avgGrnd };
}

// ── Save results ──────────────────────────────────────────────────────────────

function saveResults(results, summary) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = join(__dir, `results-${timestamp}.json`);

  writeFileSync(
    filename,
    JSON.stringify({ timestamp, summary, results }, null, 2),
    "utf8"
  );

  console.log(`\n  Results saved: eval/results-${timestamp}.json`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (!OPENAI_API_KEY) {
  console.error("\nERROR: OPENAI_API_KEY environment variable is not set.");
  console.error("Set it with: $env:OPENAI_API_KEY = 'sk-...'  (PowerShell)");
  process.exit(1);
}

console.log("\nRunning eval...\n");

const results = await runEval();
const summary = printSummary(results);

if (SAVE_OUTPUT) {
  saveResults(results, summary);
}
