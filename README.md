# Equilibria

*Physics, gently revealed.*

Equilibria turns a short video, or a single sentence, into a calm, interactive 3D physics simulation.
Pause it, rewind it, measure it and change it at your own pace, or settle into one of the ten built-in
demos, from Newton's cradle to a black hole.

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. To create new scenes, set `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
   (the demos work without one). The key stays on the server: the page sends its Gemini requests to
   `/api/gemini`, which adds the key and forwards them to Google.
3. Run the app:
   `npm run dev`, then open http://localhost:3000
4. To deploy: `npm run build`, then `npm start` (serves `dist/` and the Gemini proxy; set `PORT` and
   `GEMINI_API_KEY` in the host's environment, or in `.env.local`)
