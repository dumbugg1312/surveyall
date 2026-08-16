# Setting up SurveyAll

**Who this is for:** you're comfortable with GitHub — fork a repo, edit a file in the browser, commit — but you are not a professional developer. **You will not need a terminal, Node, or npm at any point.**

**Time:** about 25 minutes, once.
**Cost:** $0, and **no credit card at any step**. If a page asks for payment details, you've wandered into the wrong product — back up. (The one Cloudflare product that demands a card is **R2** storage. SurveyAll deliberately doesn't use it.)

**What you end up with:** your own copy of SurveyAll at an address like `https://surveyall.your-name.workers.dev`.

---

## The 30-second overview

Everything runs as **one Cloudflare Worker**: it serves the web pages *and* the API from the same address. That means one deploy, no separate hosting, and nothing to keep in sync.

| Part | What it does |
|---|---|
| Worker | Serves the site and the API |
| D1 | The database — decks, sessions, answers |
| Durable Objects | Keeps the room in sync live |

Nothing sleeps. Nothing pauses after a week. There is no project cap to hit.

---

## Step 1 — Put the code in your GitHub account

1. At the top of this repository, click **Fork**.
2. Name it `surveyall`.
3. Public or private both work here — unlike GitHub Pages, Cloudflare can deploy a private repo on the free plan. **Public is fine**: nothing secret is in this repo, and your password never will be.
4. Click **Create fork**.

---

## Step 2 — Create your Cloudflare account

1. Go to **[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)**.
2. Sign up with an email and password. **No card is required.**
3. Verify your email.

You do not need to add a domain. Skip anything that asks you to.

---

## Step 3 — Create the database

1. In the Cloudflare dashboard sidebar: **Storage & Databases → D1 SQL Database**.
2. Click **Create**, name it exactly `surveyall`, and create it.
3. When it opens, copy the **Database ID** (a long string of letters, numbers and dashes). You need it in Step 4.
4. Still on that database, open the **Console** tab.
5. Open `worker/schema.sql` from your fork, copy **all** of it, paste it into the console, and run it.

Success looks like a handful of statements executing with no error. It's safe to re-run if you're unsure.

---

## Step 4 — Paste the database ID into the config

1. In *your* fork on GitHub, open **`wrangler.jsonc`**.
2. Click the pencil to edit.
3. Find this line:

```jsonc
"database_id": "PASTE_YOUR_DATABASE_ID_HERE"
```

Replace the placeholder — keeping the quote marks — with the Database ID from Step 3.

4. **Commit changes**.

That is the only file you ever need to edit.

---

## Step 5 — Deploy the Worker from GitHub

1. Cloudflare dashboard → **Compute (Workers) → Workers & Pages**.
2. Click **Create** → **Import a repository** (sometimes shown as "Connect to Git").
3. Authorise Cloudflare to see your GitHub, and pick your `surveyall` repo.
4. Cloudflare should detect the settings from `wrangler.jsonc`. Leave the build command empty if offered; the deploy command should be `npx wrangler deploy` (usually prefilled).
5. Click **Create and deploy**.

The first build takes a couple of minutes. Cloudflare runs the deploy on its own servers — this is why you never need Node installed.

When it finishes you'll get a URL like `https://surveyall.your-name.workers.dev`. Open it. You should see the SurveyAll join screen.

> **If the build fails**, open the build log and read the last few lines. The two common causes are a mistyped `database_id`, or the D1 database being named something other than `surveyall`.

---

## Step 6 — Set your password and signing key

Two secrets. Cloudflare encrypts both; neither is ever in your repo.

1. Dashboard → **Workers & Pages → surveyall → Settings → Variables and Secrets**.
2. Add a secret (**Encrypt** / "Secret", *not* plain text):
   - Name: `INSTRUCTOR_PASSWORD`
   - Value: a password you choose. **This is the only thing protecting your decks — make it a real password**, not `poll123`.
3. Add a second secret:
   - Name: `AUTH_SECRET`
   - Value: a long random string. Mash the keyboard for 40+ characters, or use a password manager's generator. You never type this again.
4. **Deploy** / save so the secrets take effect.

> **There is no sign-up and no password reset.** One instructor, one password. If you forget it, come back here and set a new one — your decks and results are untouched.

---

## Step 7 — Sign in

1. Open your Worker URL.
2. Click **I'm the instructor**, enter the password from Step 6.

You should land on **Decks**.

---

## Running your first class

**Before class**

1. Sign in → **Decks**.
2. **New deck**, name it, and you're in the editor.
   - Questions on the left; **Theme** and **Background** on the right.
   - Or **Import from text** on the dashboard and start from the built-in sample.
3. **Start session** → label it (`Tue 9am section`) → you land on the projector view.

**In class**

1. Open the session's **Present** page on the projector. Press **F** for fullscreen.
2. Students scan the QR. They land straight on the question — no app, no account, no name.
3. Press **→** to advance. Results animate as answers arrive.

**Keys worth knowing** (move the mouse to reveal the control bar too):

| Key | Does |
|---|---|
| `→` / `←` | Next / previous question |
| `H` | Hide or show results — poll blind, then reveal |
| `C` | Close or reopen voting |
| `T` or `1`–`9` | Timer (number = that many × 10 seconds) |
| `R` | **Re-ask** — same question, fresh round, keeps the old one |
| `D` | **Compare** the two rounds and show what changed |
| `L` | Quiz leaderboard |
| `Q` | Questions from the room (approve them here) |
| `J` | Hide/show the corner QR |
| `F` | Fullscreen |
| `X` | Delete this question's answers and start over |

**The re-ask move is the one worth practising.** Ask a hard question, don't reveal (`H`), let them argue in pairs for two minutes, press `R`, ask again, then `D`. The screen shows exactly what changed. That's peer instruction in three keystrokes.

**After class**

**Decks → Recent sessions → Results.** Everything is kept permanently, and **Download CSV** gives you the raw data. Free, always.

---

## Reusing a deck next semester

- **Same deck, new session:** click **Start session** again. Fresh join code, separate results; the old ones stay put.
- **Copy the deck:** open it → **Text view** → **Copy**. Then **Import from text** on the dashboard and paste.

**Text view is also your backup.** Click **Download** for a plain `.txt` of the whole deck. Keep it in Dropbox. If this project, Cloudflare, or GitHub ever goes away, your questions are still yours in a file you can read.

---

## Writing decks as text

Faster than clicking once you're used to it:

```
# Week 3 — Social institutions
theme: chalkboard
background: gradient-dusk

## word_cloud
One word: how did the reading leave you feeling?
max_words: 2

## multiple_choice
Which of these is a social institution?
- Marriage
- A friendship
- [x] The economy
- A crowd at a concert

## scales (1..7)
How confident are you about each of these?
~ Reading dense academic writing
~ Writing an argument with sources
allow_skip: true

## quiz (25s)
Who wrote "The Protestant Ethic"?
- Durkheim
- [x] Weber
- Marx

## ranking
Rank these by influence
- Family
- Media
- Peers

## open_ended
What should I re-explain next class?
max_length: 200

## qa
Ask me anything, anonymously
```

Rules: `#` names the deck, `##` starts a question, `-` is an option, `- [x]` marks a correct answer, `~` is a scale statement, `key: value` sets an option, `//` is a comment.

---

## Student privacy — what to tell your department

If anyone asks whether this is FERPA-compliant, the honest answer is stronger than "we handle data carefully":

- **No student identifiers are collected anywhere.** No name field, no login, no email, no student ID, no IP logging. The database has no column that could hold one.
- **The only per-response label is a random nickname** like "Amber Falcon", assigned by the server for that single session and never reused. Two sessions cannot be linked to reconstruct one student's history.
- **No cookies, no analytics, no third-party trackers.** The nickname lives in the browser tab and disappears when it closes.
- **Quiz leaderboards work without identity** — they rank nicknames.
- **CSV exports contain nothing to redact.**

**The one honest caveat:** a student can type their own name into an open-ended answer. No polling tool can prevent that. The answer box says "no need to include your name", and you can delete any response with one click from the projector view.

Technical detail if IT asks: `docs/architecture.md` §5 lists every enforcement point, and `worker/schema.sql` is short and readable.

---

## When something goes wrong

**"Not finished setting up"**
The site is deployed but the API isn't answering. Almost always the `database_id` in `wrangler.jsonc`, or `worker/schema.sql` hasn't been run. Re-check Steps 3–4.

**"That password doesn't match"**
`INSTRUCTOR_PASSWORD` isn't set, or was saved as a plain-text variable rather than an encrypted secret. Re-do Step 6 and redeploy.

**Students see "No session found for ABC123"**
The session was deleted, or they're on a different copy of the site. Check the code on your screen.

**Nothing happens when I press →**
Click the slide once so the page has keyboard focus.

**Results aren't updating live**
The app falls back to polling every few seconds, so give it a moment. If it's stuck, reload the presenter page — the live connection reconnects on its own.

**The build failed after I changed something**
Workers & Pages → surveyall → **Deployments** → open the failed build → read the last lines of the log. You can always roll back to a previous working deployment from that same screen.

**I forgot my password**
Step 6, set a new one. Nothing is lost.

**The QR code doesn't appear**
It's fetched from a public library on first load; a very restrictive network can block it. The join code and address are always shown next to it, so students can still type it in.

---

## Checking things before class

Open `tests/visual-check.html` on your site (e.g. `https://surveyall.your-name.workers.dev/tests/visual-check.html`). It renders every chart type with fake data and lets you flip through all eight themes — handy for checking a theme is readable on your particular projector before you're standing in front of 60 people. Click **Simulate a live class** to watch results animate in.

---

## What it costs to run

Nothing, at your scale, with room to spare. Per free-tier day you get 100,000 Worker requests, 100,000 Durable Object requests, 5 million database rows read and 100,000 written. One 60-student class with a 20-question deck uses roughly **1,500 requests and 1,200 database writes** — so you could run dozens of sections a day and stay inside the free tier. Static page loads don't count against any of it.

Full numbers with sources: `docs/architecture.md` §3.
