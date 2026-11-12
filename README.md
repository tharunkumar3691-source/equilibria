# Equilibria

*Physics, gently revealed.*

Equilibria turns a textbook problem, a short video or a single sentence into an interactive 3D physics
simulation that has been **checked before you see it**. Students pause it, rewind it, measure it and change it
by talking to it. New scenes are paid for with **PayPal** credits, and you only pay for physics that checks out:
a scene that never passes its physics test gives its credit back.

It uses the **PayPal Orders v2
REST API, the PayPal JavaScript SDK and PayPal Webhooks (sandbox)**.

---

## What it does

| | |
|---|---|
| **Solve and simulate** | Paste a textbook problem (or a photo of one). Gemini solves it step by step, a separate pass builds a 3D simulation *without seeing the answer*, the app measures the answer in the simulation, and any disagreement is worked out before you see either. |
| **Video to simulation** | Upload a few seconds of video. Gemini measures the motion and rebuilds it as a live 3D scene. |
| **Describe a scene** | "A heavy ball rolls down a ramp into a stack of crates" becomes a running simulation. |
| **Change it by talking** | The assistant edits the open scene ("make gravity like the Moon"), and every edit is tested before it is applied. |
| **Credits with PayPal** | Each new scene costs 1 credit, bought with PayPal. Demos, the library and chat edits are free. |
| **Verified or free** | If a generated scene never passes its automatic physics test, the credit is returned by itself. |
| **AI assistant that handles payments** | Tell the assistant "I need credits for my class of 30": it checks your balance, picks the right pack, creates the PayPal order and opens PayPal's window. You approve it there; nothing is charged until you do. |
| **Pay it forward** | Anyone can buy credits for a shared student pool. A student who has run out (and cannot pay) can take a small share each day. |
| **12 free demos** | Newton's cradle, domino spiral, solar system, black hole, time dilation, pendulum wave, loop-the-loop and more. |

## Who it is for

Students who find physics hard to picture: a static textbook diagram does not show what friction, momentum or
a projectile's path actually *do*. Teachers and study groups can buy a class pack, and anyone can sponsor
scenes for students who cannot pay.

---

## How PayPal is used

All PayPal calls are made from the server ([server/paypal.ts](server/paypal.ts)); the client secret never
reaches the browser. **Sandbox only**: no real money moves.

| PayPal product | Where | What it does |
|---|---|---|
| **OAuth 2.0 client credentials** | `server/paypal.ts` | Gets (and reuses) an access token for the REST API. |
| **Orders v2: create** (`POST /v2/checkout/orders`) | `server/paypal.ts`, `server/api.ts` | Creates a digital-goods order (no shipping, "Pay Now") for a credit pack, tagged with the buyer's anonymous device id (`custom_id`) and the pack (`reference_id`). |
| **Orders v2: capture** (`POST /v2/checkout/orders/{id}/capture`) | `server/paypal.ts`, `server/api.ts` | Captures the approved order with a `PayPal-Request-Id`, so a retry or double click can never charge twice. Credits are added **only** when the capture is `COMPLETED`, in USD, for exactly the pack's price, for the device that started the order, and only once. |
| **JavaScript SDK (Buttons)** | [components/CreditsDialog.tsx](components/CreditsDialog.tsx), [lib/credits.ts](lib/credits.ts) | Shows PayPal's own buttons and checkout window. A declined funding source restarts in the same window (`INSTRUMENT_DECLINED`). |
| **Webhooks** (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`) | `server/api.ts` | Each delivery is verified with `POST /v1/notifications/verify-webhook-signature`. A completed capture adds the credits even if the buyer closed the tab; an approved order that the page never captured is captured by the server. Optional (needs a public URL). |

## How AI is used

| AI | Where | What it does |
|---|---|---|
| GeminiDesigns each 3D scene as code, reviews pictures of what it built, and repairs problems the automatic physics test finds (up to 2 repairs). |
| **Gemini, problem solving** | [lib/problems.ts](lib/problems.ts) | Solves textbook problems step by step, builds a simulation independently, and reconciles the two when the measured answer disagrees. |
| **Gemini, video understanding** | [lib/gemini.ts](lib/gemini.ts) | Measures motion in uploaded clips and rebuilds it. |
| **Gemini function calling: scene editing** | [lib/sceneEdit.ts](lib/sceneEdit.ts) | The `update_simulation` tool rewrites the open scene; every change is tested headlessly before it is applied. |
| **Gemini function calling: payments** | [lib/paymentAgent.ts](lib/paymentAgent.ts) | Tools `get_credit_balance`, `start_paypal_checkout` and `claim_student_pool`. The model decides when they are needed and which pack fits ("my class of 30" → the class pack), and creates the PayPal order through the server. The user always approves the payment in PayPal's window. |

## How PayPal and AI work together

```
 Student ──► Create a scene ──► server takes 1 credit, opens a 30-minute "generation pass"
                                      │
                                      ▼
                    Gemini designs ─► physics test ─► repair (×2) ─► visual review
                                      │
                    passes? ──yes──► scene shown, credit kept
                       │
                       no ──────────► credit returned ("verified or free")

 Out of credits ──► "I need credits for my class"
                         │
                         ▼
             Gemini (function calling) ── get_credit_balance ──► picks the class pack
                         │
                         └── start_paypal_checkout ──► server creates PayPal order (Orders v2)
                                                              │
                                PayPal window (JS SDK) ◄──────┘  user approves
                                                              │
                         server captures (Orders v2) ◄────────┘  + webhook as a backup
                                                              │
                                     credits added ◄──────────┘  (or given to the student pool)
```

The Gemini proxy ([server/geminiProxy.ts](server/geminiProxy.ts)) only forwards a scene's requests while its
pass is open, so the AI cannot be used without paying by going around the page. Chat questions and edits are
free up to a daily number per visitor, and the whole server has a daily cap on Gemini requests.

---

## Try it

**Hosted demo:** see the Devpost submission for the link.

**Judges / testers:**
1. Every new visitor starts with **5 free credits** on the hosted demo (3 by default when you run it yourself): try *Solve and simulate* or *Describe* straight away.
2. To buy credits, click the credits badge in the *Create* panel (or ask the assistant
   "I need credits for my class"). Sign in to PayPal with the **sandbox buyer account** given in the
   submission's testing instructions. No real money moves.
3. To see *verified or free*, watch the balance after a scene that fails its check: the credit comes back.
4. To see the student pool, choose *Gift to students* in the credits window, then (in another browser with
   0 credits) take a share of it.

## Run it yourself

**Prerequisites:** Node.js 22.18 or newer (the server is TypeScript run directly by Node).

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in:
   - `GEMINI_API_KEY`
   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: on [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox),
     choose **Sandbox**, create an app, and copy its client id and secret.
   - Your sandbox **buyer** login is under *Sandbox → Accounts* (the *Personal* account).
3. Start the dev server and open http://localhost:3000:
   ```bash
   npm run dev
   ```
4. For production: `npm run build`, then `npm start` (serves `dist/`, the API and the Gemini proxy on `PORT`).

The demos work without any keys. Without the PayPal keys the app runs, and the credits window says PayPal is
not set up.

**Tests:** `npm test` runs 19 end-to-end checks of the credits, PayPal and webhook endpoints against fake
PayPal and Gemini servers (no keys or network needed): idempotent captures, wrong amounts, orders from another
browser, the student pool, refunds, Gemini metering, forged webhooks, the health check, and payments surviving
an immediate restart.

### Deploy on Render

[render.yaml](render.yaml) is a Render Blueprint: in Render choose **New → Blueprint**, pick this repository,
and fill in the secret values. It builds with `npm ci --include=dev && npm run build` and starts with
`npm start`. The blueprint uses a paid instance with a 1 GB disk so balances survive restarts and judges
never wait for a cold start; for the free plan, remove the `disk` block and `DATA_DIR`.

**Webhook (optional):** in the PayPal sandbox app, add a webhook for
`https://<your-app>.onrender.com/api/paypal/webhook` with the events *Checkout order approved* and
*Payment capture completed*, and set its id as `PAYPAL_WEBHOOK_ID`.

## Architecture

| Path | Role |
|---|---|
| `App.tsx`, `components/` | React UI: the 3D runner (Three.js + cannon-es), sidebar, assistant, credits window |
| `lib/gemini.ts`, `lib/problems.ts`, `lib/sceneEdit.ts` | Gemini scene generation, problem solving and editing |
| `lib/paymentAgent.ts` | The assistant's PayPal tools |
| `lib/credits.ts` | The page's side of credits and the PayPal JS SDK |
| `lib/validate.ts`, `lib/headless.ts` | The headless physics test every scene must pass |
| `server/api.ts` | Credits, student pool, PayPal orders and webhook endpoints |
| `server/credits.ts` | Balances, generation passes, refunds and the pool (a JSON file in `DATA_DIR`) |
| `server/paypal.ts` | PayPal REST client (OAuth, Orders v2, webhook verification) |
| `server/geminiProxy.ts` | Keeps Gemini keys on the server and meters requests |
| `server/api.test.ts` | End-to-end tests of the API (`npm test`) |
| `server/index.ts` | Production server |

**Privacy:** there are no accounts. A visitor is a random id in an HttpOnly cookie. Payment details stay with
PayPal; Equilibria only stores the order id, pack, amount and status.

## Built with

React 19, TypeScript, Vite 6, Tailwind CSS 4, Three.js, cannon-es, KaTeX, the Google Gen AI SDK
(`@google/genai`), the PayPal REST API and JavaScript SDK, and Node's built-in HTTP server. Deployed on Render.

## License

[MIT](LICENSE)
