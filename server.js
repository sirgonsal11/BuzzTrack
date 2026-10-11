// ============================================================
// Checkpoint — GT Onboarding App backend
// Express + Groq API + JSON file storage
// ============================================================

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DEADLINES_FILE = path.join(__dirname, 'data', 'deadlines.json');
const EMAILS_FILE = path.join(__dirname, 'data', 'emails.json');
// Groq's model lineup changes over time — if this model ever 404s, check
// console.groq.com/docs/models for the current list and swap it in.
const GROQ_MODEL = 'openai/gpt-oss-120b';

// ------------------------------------------------------------
// Small file helpers — this IS our "database" for the hackathon
// ------------------------------------------------------------

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// A few known real GT process dependencies — hardcoded and small on purpose.
// We do NOT ask the AI to invent dependencies; it doesn't reliably know GT's
// actual system behavior, and a wrong guess could incorrectly block a student.
// Edit this list as your team verifies real requirements.
const KNOWN_DEPENDENCY_RULES = [
  // Example: registration tasks depend on an uncompleted financial deposit task
  { ifCategory: 'registration', dependsOnCategory: 'financial' }
];

function computeDependsOn(newItem, existingItems) {
  const dependsOn = [];
  for (const rule of KNOWN_DEPENDENCY_RULES) {
    if (newItem.category === rule.ifCategory) {
      const blocker = existingItems.find(
        item => item.category === rule.dependsOnCategory && item.status !== 'completed'
      );
      if (blocker) dependsOn.push(blocker.id);
    }
  }
  return dependsOn;
}

// ------------------------------------------------------------
// Groq call helper (OpenAI-compatible chat completions endpoint)
// ------------------------------------------------------------

async function callGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('Groq returned no text content');

  // Models sometimes wrap JSON in ```json fences even when told not to — strip them.
  return rawText.replace(/```json|```/g, '').trim();
}

// ============================================================
// GET /api/deadlines — return the full checklist
// ============================================================
app.get('/api/deadlines', (req, res) => {
  try {
    res.json(readJSON(DEADLINES_FILE));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not read deadlines' });
  }
});

// ============================================================
// GET /api/emails — return the raw email log
// ============================================================
app.get('/api/emails', (req, res) => {
  try {
    res.json(readJSON(EMAILS_FILE));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not read emails' });
  }
});  

// ============================================================
// POST /api/parse-email — parse a raw email into a checklist item,
// checking for duplicates against what's already tracked
// ============================================================
app.post('/api/parse-email', async (req, res) => {
  const emailText = (req.body.emailText || '').trim();
  if (!emailText) {
    return res.status(400).json({ error: 'emailText is required' });
  }

  try {
    const existingDeadlines = readJSON(DEADLINES_FILE);

    const prompt = `You are parsing Georgia Tech new-student onboarding emails into a checklist system.

EXISTING TRACKED ITEMS (for duplicate checking):
${JSON.stringify(existingDeadlines.map(d => ({ id: d.id, task: d.task, category: d.category, deadline: d.deadline })))}

NEW EMAIL TO PROCESS:
"""
${emailText}
"""

RULES:
1. If this email describes a task/deadline that is ALREADY represented in the existing list
   (even if worded differently — e.g. a "reminder" or "final notice" about the same thing),
   respond with the duplicate format below.
2. If it's genuinely new, respond with the new-item format below.
3. TASK GRANULARITY: extract one task per distinct, coherent action with its own deadline
   (e.g. "Pay $200 housing deposit"). Do NOT break a single action into sub-steps
   (e.g. do not split "log in", "find payment page", "submit payment" into separate tasks).
   If the email genuinely contains multiple separate requirements with different purposes
   or deadlines, extract each as its own item — but only call parse-email once per email,
   so just extract the single most prominent task if there are several; the rest can be
   submitted as separate emails.
4. LINKS: extract ONLY URLs that are explicitly present in the email text, each with a short
   label describing where it goes. If the email mentions multiple relevant links (e.g. two ways
   to complete the same requirement), include all of them. If no URL is present, use an empty
   array. NEVER invent, guess, or fabricate a URL.
5. deadline must be in YYYY-MM-DD format, or null if no date is mentioned.
6. priority is "high", "medium", or "low" based on urgency/consequences implied in the email.
7. category is exactly one of: "housing", "registration", "health", "financial", "other".

Respond with ONLY one of these two JSON shapes, no other text, no markdown formatting:

DUPLICATE FORMAT:
{"action": "duplicate", "matchingId": "<id of the existing matching item>"}

NEW ITEM FORMAT:
{"action": "new", "item": {
  "task": "<short description of the single action needed>",
  "deadline": "<YYYY-MM-DD or null>",
  "priority": "<high|medium|low>",
  "category": "<housing|registration|health|financial|other>",
  "links": [{"label": "<short label>", "url": "<exact url from email>"}]
}}`;

    const rawResult = await callGroq(prompt);
    let parsed;
    try {
      parsed = JSON.parse(rawResult);
    } catch (parseErr) {
      console.error('Groq returned non-JSON:', rawResult);
      return res.status(502).json({ error: 'AI returned an unexpected format, try again' });
    }

    // Always log the raw email, regardless of duplicate/new — it's still useful chatbot context
    const emailLog = readJSON(EMAILS_FILE);
    emailLog.push({ text: emailText, receivedDate: new Date().toISOString() });
    writeJSON(EMAILS_FILE, emailLog);

    if (parsed.action === 'duplicate') {
      return res.json({ status: 'duplicate', matchingId: parsed.matchingId });
    }

    if (parsed.action === 'new' && parsed.item) {
      const newItem = {
        id: crypto.randomUUID().slice(0, 8),
        task: parsed.item.task,
        deadline: parsed.item.deadline || null,
        priority: parsed.item.priority || 'low',
        category: parsed.item.category || 'other',
        links: Array.isArray(parsed.item.links) ? parsed.item.links : [],
        status: 'not_started',
        dependsOn: []
      };
      newItem.dependsOn = computeDependsOn(newItem, existingDeadlines);

      existingDeadlines.push(newItem);
      writeJSON(DEADLINES_FILE, existingDeadlines);

      return res.json({ status: 'added', item: newItem });
    }

    return res.status(502).json({ error: 'AI response did not match expected format' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse email' });
  }
});

// ============================================================
// POST /api/checklist/started — mark an item as "started"
// (only moves not_started -> started; never overwrites completed)
// ============================================================
app.post('/api/checklist/started', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    let deadlines = readJSON(DEADLINES_FILE);
    deadlines = deadlines.map(item =>
      item.id === id && item.status === 'not_started'
        ? { ...item, status: 'started' }
        : item
    );
    writeJSON(DEADLINES_FILE, deadlines);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ============================================================
// POST /api/checklist/completed — mark an item as "completed"
// (self-reported by the student, not independently verified)
// ============================================================
app.post('/api/checklist/completed', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    let deadlines = readJSON(DEADLINES_FILE);
    deadlines = deadlines.map(item =>
      item.id === id ? { ...item, status: 'completed' } : item
    );
    writeJSON(DEADLINES_FILE, deadlines);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ============================================================
// POST /api/ask — chatbot, grounded ONLY in stored data
// ============================================================
app.post('/api/ask', async (req, res) => {
  const question = (req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const deadlines = readJSON(DEADLINES_FILE);
    const emailLog = readJSON(EMAILS_FILE);

    const prompt = `You are a helpful assistant inside a Georgia Tech new-student onboarding app called Checkpoint.

The student's current tracked checklist:
${JSON.stringify(deadlines)}

The raw text of their onboarding emails, for extra context:
${JSON.stringify(emailLog)}

Student's question: "${question}"

Answer clearly and concisely using ONLY the information above. If the answer isn't in that
data, say so honestly — do not guess or make up GT policy — and suggest they check the
official GT site or their student portal directly, or that this info might not be in an
email they've added to Checkpoint yet.`;

    const answer = await callGroq(prompt);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get an answer' });
  }
});

// ============================================================
app.listen(PORT, () => {
  console.log(`Checkpoint backend running on http://localhost:${PORT}`);
});
