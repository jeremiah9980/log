# Signal · Communication Forensics

A static GitHub Pages site that analyzes call logs and text logs from Google Drive, identifies phone numbers via cross-reference and reverse lookup, and writes three enriched output sheets back to your Drive folder.

## What it does

Drop CSV files into a Google Drive folder. The site polls the folder, and when new files appear:

1. **Auto-detects file kind** (call log / text log / contacts) from headers and filename
2. **Extracts every phone number** from all logs and contacts
3. **Identifies names** through three layers (in order of confidence):
   - Names already present in the log CSV
   - Cross-reference against a contacts CSV (if you've uploaded one)
   - Claude reverse lookup (businesses, government agencies, toll-free routing — never private individuals)
4. **Writes three output files back to the same folder:**
   - `_signal_output_call_log_enriched.csv` — original call log + identified names
   - `_signal_output_text_log_enriched.csv` — original text log + identified names
   - `_signal_output_contacts_directory.csv` — every unique number across all logs with totals, durations, first/last contact, source confidence

Output files are detected on subsequent scans so they aren't reprocessed.

## Setup

### 1. Create a Google Cloud OAuth Client

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project (or pick an existing one)
2. Enable the **Google Drive API**: APIs & Services → Library → search "Drive" → Enable
3. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized JavaScript origins: add your GitHub Pages URL, e.g. `https://YOUR-USERNAME.github.io`
   - (No redirect URI needed — uses the implicit/token flow)
4. Configure the OAuth consent screen if prompted. For personal use, set User Type = External and add yourself as a test user. Add the scope `https://www.googleapis.com/auth/drive`.
5. Copy your **Client ID** (looks like `xxxxx.apps.googleusercontent.com`)

### 2. Get your Drive folder ID

Open the folder in Drive. The URL looks like:
```
https://drive.google.com/drive/folders/1abcDEF_xyz123
                                       └─── this is the folder ID ───┘
```

### 3. (Optional) Get an Anthropic API key

For reverse lookup of unidentified numbers (businesses, government, services), get a key from [console.anthropic.com](https://console.anthropic.com/). Without this key, names will only come from your contacts CSV and any names already in the logs.

The key is stored only in your browser's localStorage and never leaves your machine except in direct API calls to Anthropic.

### 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then on GitHub:
- Settings → Pages
- Source: Deploy from a branch
- Branch: `main`, folder: `/ (root)`
- Save

Wait ~1 minute. Your site will be live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

### 5. Configure the app

Open the site, click **Settings**, and paste in:
- Google OAuth Client ID
- Drive Folder ID
- Anthropic API Key (optional)

Click **Save configuration**, then **Connect Google Drive** and authorize.

### 6. Use it

1. Click **▶ Start watching** to begin polling the folder every 30 seconds
2. Drop CSV files into the Drive folder
3. Within 30 seconds, files appear in the folder list as **PENDING**, then process automatically
4. Three `_signal_output_*.csv` files appear in the same folder with results
5. Output is also visible in the **Output** section with charts and tabbed views

## CSV format detection

The app auto-detects which kind of file you've dropped from headers and filename. It works with most common exports out of the box.

| File type | Recognized headers (any of) |
|---|---|
| Call log | `phone`, `number`, plus `duration` or `call type` (or filename contains "call") |
| Text log | `phone`, `number`, plus `message`, `body`, or `text` (or filename contains "text"/"sms"/"imessage") |
| Contacts | `first name`/`last name` or `name`, plus a phone column (or filename contains "contact") |

You can drop multiple files of the same kind — they'll be merged before analysis.

## Privacy / security notes

- All processing happens in your browser. CSV contents never reach a server you don't control.
- The Anthropic key is stored in localStorage on your device. Only the unidentified phone numbers (not message bodies, not your contacts) are sent to the Anthropic API for reverse lookup.
- The Google OAuth scope used is `drive` (full access). If you prefer, you can change `DRIVE_SCOPE` in `app.js` to `drive.file` — but that limits the app to files it created, which means it can only see files you explicitly share with it via Google's file picker (not implemented here).
- Output filenames are prefixed with `_signal_output_` so the watcher knows to skip them on re-scan.

## Development

The site is fully static — no build step. Edit `app.js`, `index.html`, or `styles.css` directly. Babel-standalone transpiles JSX in the browser.

For local testing:
```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

You'll need to add `http://localhost:8000` to your OAuth client's authorized origins for local testing.

## License

MIT — see LICENSE file.
