# Velaryn Code website

Static companion site. Sign in from any device (phone included) and browse, edit, upload and download the files the desktop app syncs to your Supabase project. There is no build step: host this folder as-is on any static host that serves HTTPS (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3 and so on). HTTPS is required because hashing files uses `crypto.subtle`. `http://localhost` and `http://127.0.0.1` also work for testing.

Local preview: `cd web && python3 -m http.server 8080`, then open http://127.0.0.1:8080/

## 1. Fill in `config.js`

```js
window.VELARYN_CONFIG = {
  supabaseUrl: 'https://<project>.supabase.co',   // Project Settings → API → Project URL
  supabaseKey: '<anon / publishable key>',         // Project Settings → API → anon public key (never the service_role key)
  downloadUrl: 'https://…/Velaryn-Code.dmg',       // optional: shows the "Download for Mac" button
};
```

If `supabaseUrl`/`supabaseKey` are blank, the site asks for them and saves them in that browser's localStorage only.

The database must already have `supabase/schema.sql` applied (the same one the desktop app uses).

## 2. Supabase settings

Authentication → URL Configuration:

- **Site URL**: your site address, e.g. `https://code.example.com/`
- **Redirect URLs**: add
  - your site address (e.g. `https://code.example.com/` and, if it is served from a sub-path, that exact path)
  - `http://127.0.0.1:53682/auth/callback` (used by the desktop app)
  - optionally `http://127.0.0.1:8080/` for local testing

## 3. Enable sign-in providers

Go to Authentication → Sign In / Providers in Supabase, open each provider, paste its client ID and secret, and turn it on. Every provider needs the same **callback URL**, which Supabase also shows on that screen:

```
https://<project>.supabase.co/auth/v1/callback
```

If a provider is off, the site shows "… sign-in isn't turned on for this Supabase project".

| Provider | Where to create the client ID and secret |
|---|---|
| **Google** | [Google Cloud Console](https://console.cloud.google.com/apis/credentials): configure the OAuth consent screen, then Create credentials → OAuth client ID → *Web application*. Add the callback URL under *Authorized redirect URIs*. |
| **GitHub** | GitHub → Settings → Developer settings → [OAuth Apps](https://github.com/settings/developers) → New OAuth App. Homepage URL = your site; *Authorization callback URL* = the callback URL. Generate a client secret. |
| **Discord** | [Discord Developer Portal](https://discord.com/developers/applications) → New Application → OAuth2. Copy the Client ID and Client Secret, and add the callback URL under *Redirects*. |
| **Apple** | [Apple Developer](https://developer.apple.com/account/resources/identifiers/list) (paid account): create an App ID with *Sign in with Apple*, then a **Services ID** (this is the client ID) with your domain and the callback URL as the Return URL, then a **Key** with Sign in with Apple enabled. In Supabase, enter the Services ID and generate the secret from the key (Team ID, Key ID and .p8 file). The secret expires every 6 months. |
| **Microsoft** (`azure`) | [Azure portal](https://portal.azure.com) → Microsoft Entra ID → App registrations → New registration. Pick the supported account types (for personal + work accounts, "Accounts in any organizational directory and personal Microsoft accounts"), Redirect URI type *Web* = the callback URL. Create a secret under Certificates & secrets (use the secret's **Value**). Client ID = Application (client) ID. Leave the Azure Tenant URL blank unless you want a single tenant. |
| **GitLab** | GitLab → User settings (or Group/Admin) → [Applications](https://gitlab.com/-/user_settings/applications). Redirect URI = the callback URL; scope `read_user`. Copy the Application ID and Secret. |

Email + password works without extra setup. If "Confirm email" is on (Authentication → Sign In / Providers → Email), new accounts must click the email link before signing in.

## Phone editor (what the site does)

Open a project and you get a mobile code editor that mirrors the desktop app:
- **Files:** a file explorer, plus new file/folder, rename, delete, upload and download.
- **Editor:** tabs, search across the project, Go to file (⌘P), and the command list (⇧⌘P).
- **Coding keys:** a row above the keyboard (Tab, brackets, arrows, undo/redo, find, save).
- **Saving:** live sync with your other devices and conflict protection.
- **Claude:** works with an Anthropic API key, set in Settings → Claude. Edits arrive as unsaved changes you review.
- **Account:** your profile picture, a Devices list where you can remove devices (asks for your password), and big files of any size up to 2 GB.

Code: `app.js` (start, sign-in, routing), `core.js` (shared helpers and cloud), `workspace.js` (editor),
`claude.js` (Claude panel), `account.js` (profile, devices, settings), `icons.js`.
Publish with `../scripts/publish-web.sh`.

## Website vs. phone apps

The **website is a file manager**: projects, file details with a read-only preview, upload/download/zip,
rename, delete, devices and account. It never loads the editor.

The **phone apps (iOS/Android) carry their own copy of this code** (bundled by `mobile/bundle-web.mjs`)
and show the full editor workspace (`workspace.js`, `claude.js`). In the apps, `isApp()` is true.
They work without loading this website. Sign-in with GitHub/Discord/Google goes through `app-callback.html`,
which returns to the app via `com.velaryn.code://auth`.

After changing anything here, publish the site **and** rebuild the apps (`cd mobile && npm run android:apk`,
`npm run ios:ipa`), since the apps don't update by themselves. They show "update available" when the published
`app-version.json` is newer than theirs.
