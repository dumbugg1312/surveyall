# Setting up SurveyAll

**Who this is for:** you're comfortable with GitHub — fork a repo, edit a file in the browser, commit — but you are not a professional developer. **You will not need a terminal, Node, or npm at any point.**

**Time:** about 25 minutes, once.
**Cost:** $0, and **no credit card at any step**. If a page asks for payment details, you've wandered into the wrong product — back up. (The one Cloudflare product that demands a card is **R2** storage. SurveyAll deliberately doesn't use it.)

**What you end up with:** your own copy of SurveyAll at an address like `https://surveyall.your-name.workers.dev` — or a short one of your own, if you [add a domain](#giving-it-a-shorter-address-optional-10yr) later.

**Sharing it with colleagues:** one deployment can serve a whole department. Each instructor makes their own account with a code you hand out, and nobody can see anyone else's decks, sessions, or results. You'll be the admin, and — because this app stores no email addresses — the only person who can reset a forgotten password. Read *Password resets* below before you invite anyone.

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

## Step 6 — Set your two secrets

Cloudflare encrypts both; neither is ever in your repo.

1. Dashboard → **Workers & Pages → surveyall → Settings → Variables and Secrets**.
2. Add a secret (**Encrypt** / "Secret", *not* plain text):
   - Name: `AUTH_SECRET`
   - Value: a long random string. Mash the keyboard for 40+ characters, or use a password manager's generator. You never type this again.
   - This one signs sign-in tokens **and** protects every stored password (see `worker/auth.js`). Changing it later signs everybody out and makes every existing password unusable — so set it once and leave it.
3. Add a second secret:
   - Name: `SIGNUP_CODE`
   - Value: the code colleagues type to create an account — e.g. your department or institution abbreviation.
   - Leaving this unset switches sign-up off entirely, which is the right setting if you're the only person using the site.
4. **Deploy** / save so the secrets take effect.

> `INSTRUCTOR_PASSWORD` from earlier versions is no longer used. You can delete it once you've created your account in Step 7.

**What the sign-up code is and isn't.** It stops bots and passers-by who find the URL. It is not a strong access control: anybody who has it — or guesses it, and a short abbreviation is guessable — can create an account and see their own decks. It cannot expose anyone else's data. Rotate it here at any time; nobody already signed in is affected.

---

## Step 7 — Create your account, before anyone else

1. Open your Worker URL.
2. Click **I'm the instructor**, then **Create one**.
3. Enter your sign-up code, pick a username and a password of at least 4 characters.

You should land on **Decks**.

> **Do this before you give the sign-up code to anybody.** The first account created becomes the **admin** — the only account that can reset a colleague's forgotten password — and it inherits any decks and sessions made before this version. Whoever signs up first gets both.

Once you're in, hand colleagues the site address and the sign-up code. Each account is separate: everyone sees only their own decks, sessions, and results.

---

## Password resets — read this before colleagues join

**This app stores no email addresses**, deliberately (see `worker/schema.sql`). That means there is no "forgot password" email and no self-service reset. The tradeoff is yours to manage:

- **A colleague forgets their password →** they ask you. Sign in with your admin account and set a new one for them, then tell them to change it.
- **You forget the admin password →** nobody can reset it for you. Recover it from the database directly, or create a second admin now as insurance. Tell people to use a password manager.

Nobody's decks or results are ever lost in a reset — only the password changes.

**On short passwords.** The minimum is 4 characters, so a PIN is allowed. What protects a short password here is the lockout, not the password itself.

The first four wrong attempts cost nothing — typos happen. After that, **each consecutive failure doubles the wait** before the next attempt is even considered: 15 seconds, 30, a minute, two, four, and on up to a one-hour cap. Guessing a 4-digit PIN means grinding all 10,000 possibilities at roughly one per hour, which is **over a year** of uninterrupted automated attempts against one specific username. A correct password wipes the counter instantly, and a failure more than a day old is forgotten, so ordinary mistyping never accumulates.

**The tradeoff, which you should know before someone discovers it the hard way:** anyone who knows a colleague's username can deliberately fail sign-ins and keep them locked out. That is why the cap is one hour rather than a day — and why an admin reset clears the lock immediately. If someone is locked out ten minutes before class, reset their password and they are straight back in.

---

## Upgrading an existing deployment to accounts

If you were running the single-password version:

1. Re-run `worker/schema.sql` (Step 3). Every statement is idempotent — it adds the two new tables and leaves your existing data untouched.
2. Add `SIGNUP_CODE` and confirm `AUTH_SECRET` is still set (Step 6).
3. Deploy, then **create your account immediately** (Step 7). Your existing decks and sessions transfer to it automatically.
4. Delete the old `INSTRUCTOR_PASSWORD` secret.

Everyone signed in on the old version is signed out by the upgrade and needs to sign in again — old tokens identified nobody, so they are refused rather than honoured.

---

## Running your first class

**Before class**

1. Sign in → **Decks**.
2. **New deck**, name it, and you're in the editor.
   - Your slides run down the left as miniatures — click one to open it, drag to reorder. **New slide** shows every layout; **Theme** and **Background** are on the right.
   - Start with an **Instructions** slide so the room can join, then add questions.
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

## Giving it a shorter address (optional, ~$10/yr)

`surveyall.your-name.workers.dev` is 36 characters, and students type it on phones while
you're trying to start class. A short domain is the single biggest quality-of-life
improvement you can make, and it takes about five minutes.

1. **Register the domain** at [domains.cloudflare.com](https://domains.cloudflare.com),
   signed in to **the same Cloudflare account** that runs the Worker. Cloudflare Registrar
   sells at wholesale — no markup, free WHOIS privacy, free DNSSEC. A `.org` runs about
   $9–11/yr. Keep it short and boring: campus content filters block `.xyz`, `.cc` and
   `.link` far more often than `.org`, and a URL a third of the room can't reach is worse
   than a long one.
2. **Point it at the Worker.** Workers & Pages → your Worker → **Domains** → **Add Domain**
   → pick the domain → leave the subdomain box **empty** (that's what gives you the bare
   root, `example.org`, rather than `www.example.org`) → **Add domain**.
3. **Wait for DNS.** Cloudflare creates the record and the certificate for you — there is
   nothing to type. A freshly registered domain won't resolve immediately: the registry
   publishes the delegation on its own schedule, usually within an hour or two. Until it
   does, the `workers.dev` URL keeps working.

**No code changes.** `joinBase()` in `app/config.js` builds join links and QR codes from
whatever origin the browser is on, so the moment students land on the new domain, the QR
codes point there too. Leave `JOIN_BASE_URL` empty.

Both addresses keep working — the `workers.dev` one never goes away, which is a useful
fallback if you ever need it mid-class.

**`www` is a separate hostname and won't work on its own.** DNS has no rule that `www` is
an alias for the root, so `www.example.org` stays dead until you configure it. To catch
people who type it out of habit:

1. **DNS → Add record:** type `AAAA`, name `www`, address `100::`, **Proxied** on. That
   address is a discard prefix — nothing ever connects to it. The record exists purely so
   the hostname resolves to Cloudflare and a rule can fire on it.
2. **Rules → Redirect Rules → Templates → "Redirect from WWW to root"**, then tick
   **Preserve query string** before deploying. Without it, `?deck=…` and `?session=…` are
   stripped and the editor and results pages land on the wrong screen.

Redirect rather than a second Custom Domain, deliberately: `joinBase()` builds the
projected join URL from whatever origin the browser is on, so if you ever presented from
the `www` address, the projector would show students the longer one. The redirect forces
everything back to the short address you paid for.

Deploying the rule can take a few seconds to reach the edge — a `522` immediately after
means it hasn't propagated yet, not that it's misconfigured.

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

## instructions
Join in before we start
- Point your phone's camera at the QR code.
- Or go to the address on screen and type %CODE%.
join: true

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

Rules: `#` names the deck, `##` starts a slide, `-` is an option, `- [x]` marks a correct answer, `~` is a scale statement, `key: value` sets an option, `//` is a comment.

**`## instructions`** is the one slide with nothing to answer — it projects your steps next to a large QR code and join code, for the first two minutes of class. Its `-` lines are the steps, and `%CODE%` in a step is replaced with the live join code when you present, so the same deck runs in every section without editing. `join: false` drops the QR and gives the whole slide to your text (handy for housekeeping or a title card).

---

## Student privacy — what to tell your department

There is a written page for this at **`/privacy.html`** on your own site — send people that link rather than paraphrasing. **Fill in its two placeholders (your contact address and your institution's name) before you share the site**, or it ships with `[OPERATOR EMAIL ADDRESS]` visible.

The summary, if anyone asks whether this is FERPA-compliant:

- **No student identifiers are collected anywhere.** No name field, no login, no email, no student ID, no IP logging. The database has no column that could hold one.
- **The only per-response label is a random nickname** like "Amber Falcon", assigned by the server for that single session and never reused. Two sessions cannot be linked to reconstruct one student's history.
- **No cookies, no analytics, no third-party trackers.** The nickname lives in the browser tab and disappears when it closes.
- **Quiz leaderboards work without identity** — they rank nicknames.
- **CSV exports contain nothing to redact.**
- **Instructors sharing a site cannot see each other's classes.** Every query is filtered by account; `tests/run-worker-tests.mjs` proves it against the real routes.

**Say "no student data", not "no data".** Instructor accounts store a username and a password hash — staff data, not student data, and FERPA governs student education records. Claiming the system stores nothing at all is the kind of overstatement a reviewer disproves in one question, and it would cost you the rest of the argument.

**Two honest caveats:**

1. A student can type their own name into an open-ended answer. No polling tool can prevent that. The answer box says "no need to include your name", and you can delete any response with one click from the projector view.
2. You run the database, so you can read it. It holds no student identity to read, but "the operator has access" is true of any self-hosted tool and is better said by you first. `/privacy.html` says it plainly.

**If your department has a formal software review**, route it through that. This is an independent tool, not a university-operated service, and `/privacy.html` states so.

Technical detail if IT asks: `docs/architecture.md` §5 lists every enforcement point, and `worker/schema.sql` is short and readable.

---

## When something goes wrong

**"Not finished setting up"**
The site is deployed but the API isn't answering. Almost always the `database_id` in `wrangler.jsonc`, or `worker/schema.sql` hasn't been run. Re-check Steps 3–4.

**"Incorrect username or password"**
Check the username — it's case-insensitive, but it is not your email. If you're certain it's right, an admin can reset it (see *Password resets* above).

**"Too many failed attempts. Try again in …"**
The escalating lockout, doing its job. Wait out the stated time — it's at most an hour — or ask an admin to reset the password, which clears the lock instantly. Signing in successfully wipes the counter.

**"That sign-up code is not right"**
`SIGNUP_CODE` isn't set, or was saved as a plain-text variable rather than an encrypted secret. Re-do Step 6 and redeploy. If the **Create one** button never appears, no code is configured at all.

**Everyone got signed out**
Expected once, right after upgrading to accounts. Otherwise it means `AUTH_SECRET` changed — and if it did, every stored password is now unusable too, so restore the old value if you still have it.

**Students see "No session found for ABC123"**
The session was deleted, or they're on a different copy of the site. Check the code on your screen.

**Nothing happens when I press →**
Click the slide once so the page has keyboard focus.

**Results aren't updating live**
The app falls back to polling every few seconds, so give it a moment. If it's stuck, reload the presenter page — the live connection reconnects on its own.

**The build failed after I changed something**
Workers & Pages → surveyall → **Deployments** → open the failed build → read the last lines of the log. You can always roll back to a previous working deployment from that same screen.

**I forgot my password**
Ask the admin to reset it — see *Password resets* above. There is no reset email, because no email address is stored. Nothing is lost either way.

**The QR code doesn't appear**
It's fetched from a public library on first load; a very restrictive network can block it. The join code and address are always shown next to it, so students can still type it in.

---

## Checking things before class

Open `tests/visual-check.html` on your site (e.g. `https://surveyall.your-name.workers.dev/tests/visual-check.html`). It renders every chart type with fake data and lets you flip through all eight themes — handy for checking a theme is readable on your particular projector before you're standing in front of 60 people. Click **Simulate a live class** to watch results animate in.

---

## What it costs to run

Nothing, at your scale, with room to spare. Per free-tier day you get 100,000 Worker requests, 100,000 Durable Object requests, 5 million database rows read and 100,000 written. One 60-student class with a 20-question deck uses roughly **1,500 requests and 1,200 database writes** — so you could run dozens of sections a day and stay inside the free tier. Static page loads don't count against any of it.

Full numbers with sources: `docs/architecture.md` §3.
