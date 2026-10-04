# TransferAI

AI assistant for small community hospitals that need to transfer patients to a higher-acuity hospital.
It reads the patient's chart from the EHR, picks the best receiving hospital, fills that hospital's
transfer forms, **calls the transfer center and answers its questions**, and faxes the packet.

Prototype scope: Epic FHIR **sandbox** patients only; receiving hospitals **UCLA Health, Keck Medicine of USC, Cedars-Sinai**.

## What works

| Step | How |
|---|---|
| Patient chart | Live from Epic's FHIR R4 sandbox (Backend Services OAuth). Search by name or pick a sandbox test patient. |
| Hospital choice | AI decides which capabilities the patient needs (cath lab, stroke, transplant…); hospitals lacking one drop down, then closest first. AI explains each option using only our hospital profiles. **No bed-availability guesses.** |
| Forms | Stored in the database. Arrive by **upload**, **email** (Postmark inbound) or **fax** (Sinch inbound). Fillable PDFs are filled directly; on scanned/faxed forms you drag a box once per field. AI fills every field from the chart, cites the source, and flags anything "not in record". A person must approve before sending. |
| Phone calls | **Real calls** via Twilio. The AI says it's an AI, states the request, answers questions only from the chart, navigates phone menus, waits through hold, and records accept/decline. Hospitals can call back our number with the reference # from the fax cover sheet. Live transcript on the transfer page. |
| Fax | Cover sheet + approved forms + record summary as one PDF. `FAX_PROVIDER=mock` (default) builds it without sending; `sinch` sends for real. |
| Audit | Every chart read, AI action, call, form and fax is logged in the `audit` table (no PHI in the detail). |

## Run it

```bash
npm install
cp .env.example .env     # fill in (see below)
npm run dev              # http://localhost:3000
```

Phone, fax and email webhooks need a public HTTPS URL. Free option:
`cloudflared tunnel --url http://localhost:3000` → put the URL in `PUBLIC_URL`.

### 1. Epic sandbox (free)
1. Create an account at https://fhir.epic.com → **My Apps → Create**. Application audience: **Backend Systems**.
2. Select R4 read APIs: Patient, Condition, Observation, MedicationRequest, AllergyIntolerance, Encounter, Procedure, Coverage, DocumentReference.
3. `npm run epic:key` → paste `EPIC_PRIVATE_KEY` into `.env`. In Epic, set the **Non-Production JWK Set URL** to `{PUBLIC_URL}/api/jwks` (or upload the printed public key).
4. Copy the **Non-Production Client ID** into `EPIC_CLIENT_ID`. New Epic apps can take a while to become active in the sandbox.

### 2. AI model (free to start)
Any model works by changing two variables:
- Gemini free tier: `LLM_PROVIDER=google`, `LLM_MODEL=gemini-flash-latest`, key from https://aistudio.google.com
- Local, no data leaves your machine: `LLM_PROVIDER=ollama`, `LLM_MODEL=qwen3:8b` (or any model you've pulled)
- Also: `anthropic`, `openai`, or any OpenAI-compatible endpoint (`LLM_PROVIDER=<name>` + `LLM_BASE_URL`).

### 3. Twilio (real calls, ~$1.15/month per number + ~$0.014/min)
1. Create an account, buy a voice number → `TWILIO_*` vars. (Trial accounts can only call verified numbers and play a trial message; upgrading with ~$20 removes that.)
2. On the number, set **A call comes in** → Webhook `POST {PUBLIC_URL}/api/voice/twilio?step=inbound`.
3. Set `CALL_TEST_NUMBER` to **your own phone** and play the transfer center yourself. The patients are fake, so don't call real transfer centers.

### 4. Forms by email (optional, Postmark free tier)
Inbound webhook URL: `{PUBLIC_URL}/api/inbound/email?token={WEBHOOK_TOKEN}`. PDF/PNG/JPG attachments become forms; the sender's domain picks the hospital.

### 5. Fax (optional, Sinch)
`FAX_PROVIDER=sinch` + `SINCH_*`. Set the number's incoming-fax webhook to `{PUBLIC_URL}/api/fax/webhook?token={WEBHOOK_TOKEN}`.
Received faxes become forms. Check the first real inbound fax: Sinch's payload format here is written from their docs, not yet tested live.

## Demo script (accelerator)
1. Patients → open an Epic sandbox patient → enter the reason (e.g. "NSTEMI, needs cath") → **Start transfer**.
2. **Rank hospitals with AI** → read why → **Choose**.
3. **Fill with AI** on the hospital's form → show sources and amber "not in record" fields → approve.
4. **Call now** → your phone rings → ask "What's her potassium? Any allergies? Code status?" → say "We accept, bed 4" → status flips to *accepted*.
5. **Send fax** → open the packet.

## Code map
```
lib/epic.ts       Epic OAuth + FHIR fetch (swap URLs for Oracle Health/Cerner)
lib/summary.ts    FHIR → compact chart summary (the only patient data the AI sees)
lib/hospitals.ts  UCLA / Keck / Cedars profiles + capabilities
lib/ranking.ts    capability filter + distance + AI rationale
lib/forms.ts      detect fields, AI fill, write PDF
lib/voice.ts      Twilio calls + AI answers
lib/fax.ts        fax packet + mock/Sinch sending
lib/llm.ts        model-agnostic AI (env-selected provider)
lib/db.ts         SQLite tables + audit log
app/              pages, server actions (app/actions.ts), webhooks (app/api)
```

`npm test` runs unit tests (chart summary, ranking, PDF filling, fax packet, Twilio call flow with signed requests).

## Before real patient data (HIPAA)
The prototype uses free services **without** BAAs, which is fine for synthetic sandbox data only. Before a pilot:
- Sign BAAs and switch by env var: LLM → AWS Bedrock / Azure OpenAI / Anthropic or OpenAI enterprise; Twilio (HIPAA-eligible plan); Sinch fax; email provider.
- Host on a BAA-covered platform (AWS/GCP with the Dockerfile), Postgres with encryption at rest, backups.
- Replace the shared password with per-user login (SSO), and record the user in the audit log.
- Confirm every hospital contact in `lib/hospitals.ts` (all are marked `verified: false`).
