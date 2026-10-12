# BuzzTrack

A Georgia Tech onboarding assistant that turns messy new-student emails into a checklist, then answers questions using only the emails and tasks you’ve added.

Built for Ignite Hackathon. Paste an email, extract the task, deadline, and links, track progress, and ask a grounded chatbot what still needs to get done.

## Features

- **Email → checklist.** Paste the raw text of an onboarding email. An LLM extracts one coherent task: description, deadline, priority, category, and any URLs that actually appear in the email.
- **Duplicate detection.** Reminder or follow-up emails about the same requirement are recognized so they don’t create a second task.
- **Progress tracking.** Tasks move from not started → started (when you open a link) → completed (self-reported).
- **Dependency locking.** Known GT process rules can lock a task until a blocker is finished (for example, registration waiting on an incomplete financial item). Rules are hardcoded on purpose so the model does not invent campus policy.
- **Grounded chatbot.** “Ask BuzzTrack” answers only from the stored checklist and email log. If the answer isn’t in that data, it says so instead of guessing GT policy.
- **Email log.** Every pasted email is kept so you can reopen the original message and so the chatbot has extra context.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js |
| Server | Express |
| Frontend | Single-page `public/index.html` (no framework) |
| Storage | JSON files in `data/` (no database) |
| LLM | Groq Chat Completions API (`openai/gpt-oss-120b`) |

## Project structure

```
gt-onboarding-app/
├── server.js            # Express API + Groq calls
├── public/index.html    # UI, checklist, chatbot
├── data/
│   ├── deadlines.json   # checklist items
│   └── emails.json      # raw pasted emails
├── package.json
└── .env                 # GROQ_API_KEY (you create this; not committed)
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (needed for built-in `fetch`)
- npm (comes with Node)
- A free [Groq](https://console.groq.com/) API key (required for parsing emails and the chatbot)

The checklist UI still loads without a key, but **Parse email** and **Ask BuzzTrack** will fail until `GROQ_API_KEY` is set.

## Run locally

1. Clone the repo and enter the project folder:

   ```bash
   git clone https://github.com/sirgonsal11/BuzzTrack.git
   cd BuzzTrack
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:

   ```
   GROQ_API_KEY=your_groq_api_key_here
   ```

   Optional:

   ```
   PORT=3000
   ```

   Get a key at [console.groq.com](https://console.groq.com/) → API Keys.

4. Start the server:

   ```bash
   npm start
   ```

   For auto-reload while developing:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Try it in a few minutes

1. Paste a sample onboarding email into **Add an onboarding email** and click **Parse email**.
2. Confirm a task appears in **Your checklist** (or a duplicate message if that requirement is already tracked).
3. Open a task link if one exists, then check **I finished this**.
4. Ask the chatbot something like `what's still incomplete?` or `what's due this week?`

The repo ships with sample data in `data/deadlines.json` and `data/emails.json`, so the checklist is not empty on first load.

### Example email to paste

```
Welcome to Georgia Tech Housing!

Please complete the online Housing Welcome Guide before move-in.
Deadline: August 1, 2026
Priority: please complete this as soon as possible.

Guide: https://housing.gatech.edu
```

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/deadlines` | Full checklist |
| `GET` | `/api/emails` | Raw email log |
| `POST` | `/api/parse-email` | `{ "emailText": "..." }` → parse into a task |
| `POST` | `/api/checklist/started` | `{ "id": "..." }` → mark started |
| `POST` | `/api/checklist/completed` | `{ "id": "..." }` → mark completed |
| `POST` | `/api/ask` | `{ "question": "..." }` → grounded chatbot |

## Design notes

- Storage is two JSON files so the hackathon demo stays easy to run: no Docker, no database, no cloud account besides Groq.
- The parser is instructed to extract **one** prominent task per email, use only URLs present in the text, and never invent links.
- Completing a task is self-reported. The app does not log into OSCAR, BuzzPort, or housing portals to verify.
- If Groq’s model list changes and parse/chat start failing, update `GROQ_MODEL` in `server.js` to a current model from [Groq’s model docs](https://console.groq.com/docs/models).

## License

Built as a hackathon / portfolio project. Use and adapt with attribution unless a license file is added later.
