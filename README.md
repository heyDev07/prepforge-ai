# PrepForge AI

AI Interview Prep Kit: paste a job description and a company URL. PrepForge researches the company, extracts the role's requirements, and builds a verified prep kit with questions, flashcards and a day-by-day schedule.

## Quick start

```bash
npm install
cp .env.example .env   # then set OPENAI_API_KEY
npm test
```

## Batch evaluator

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Input is a JSON array of cases:

```json
[{ "id": "case-01", "jd": "…", "company_url": "http://localhost:4010", "days": 5 }]
```

Every case goes through the same pipeline as the web app. The output contains one entry per case, in input order. A failed case gets `"status": "failed"` and a structured error; it never stops the batch.

**Try it offline** with the fixture company websites and the deterministic mock model (no API key needed):

```bash
LLM_PROVIDER=mock npm run evaluate:demo            # fixtures/cases/sample-cases.json → kits.json
```

**Run against the fixture sites with the real model** (key set in `.env`):

```bash
npm run mock-sites                                  # terminal 1: serves the sites on ports 4010–4016
npm run evaluate -- --input fixtures/cases/sample-cases.json --output kits.json   # terminal 2
```

`fixtures/cases/mixed-cases.json` adds failing cases: an unreachable company, an invalid URL, invalid days, a missing id, and a duplicate submission.

| Exit code | Meaning |
|---|---|
| 0 | Output written. Individual cases may still have failed; check each `status` |
| 2 | Bad arguments, unreadable or malformed input, or invalid configuration |
| 1 | Unexpected error |
