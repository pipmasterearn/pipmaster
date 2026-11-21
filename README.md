# PIPMASTER preview

Responsive trading-terminal frontend for a simulated market. GitHub Pages hosts the static UI; Supabase is the remote authority for accounts, shared market state, demo balances, and demo trades. The browser does not persist app data or sign-in sessions.

## Deploy to GitHub Pages

1. Create a Supabase project and run both SQL files in `supabase/migrations/`, in filename order.
2. In GitHub, add repository Actions secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Use the project URL and the public anon/publishable key only. Never expose a Supabase service-role key.
3. In repository **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
4. Push to the `main` branch or run the **Deploy to GitHub Pages** workflow manually.
5. Add the deployed Pages URL (including the repository path, for example `https://OWNER.github.io/REPOSITORY/`) to the Supabase Auth site's URL configuration and allowed redirect URLs.

The workflow builds with Vite's relative asset paths, so the app works both as a project Pages site and at a custom domain. Supabase URL/key values are compiled into the public frontend; the anon/publishable key is safe to expose only when the database policies and functions remain in place.

## Local development

```sh
npm ci
copy .env.example .env
# Add the Supabase project URL and public anon/publishable key to .env
npm run dev
```

Local development serves the same remote-backed app. It does not create local accounts, save local app state, or run local trade/market calculations. Supabase Auth sessions are memory-only and end when the page is reloaded or closed. Use Vite (`npm run dev`) rather than opening `index.html` with VS Code Live Preview; the source imports CSS through Vite, while the GitHub Actions workflow publishes the bundled `dist` output.

## Supabase account setup

1. Apply `supabase/migrations/202611210001_profiles_and_avatars.sql`, then `supabase/migrations/202611210002_remote_demo_terminal.sql`.
2. Public users register through Supabase Auth. Passwords and profile information are managed remotely; demo balances and trades are stored per user in Supabase.
3. To provision the single administrator, create/confirm the owner's Auth account once, then run this in the Supabase SQL Editor:

   ```sql
   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.user_id = u.id
     and lower(u.email) = lower('pipmasterearn@gmail.com');
   ```

   The database constraint allows at most one admin, and authenticated users cannot change their own role. Admin controls update shared Supabase market settings, so price movement and payout settings apply to all users.

4. Configure the Supabase Auth site URL and redirect allowlist for the deployed Pages URL. For local development, also allow `http://localhost:5173/`.

## What this preview does not provide

- The market is simulated; its shared price ticks and settings are stored and updated through Supabase RPCs.
- Demo trades, balance changes, settlement, scanner results, and strategy signals are handled by protected database functions.
- Trade settlement is processed on the next authenticated market poll after expiry; the market advances while signed-in users are viewing it.
- Live trading, real-money balances, deposits, withdrawals, and payment integrations are not connected.

A production launch involving real funds requires a secured backend, independent review of settlement and outcome rules, audited transaction records, verified payment integrations, and appropriate legal/compliance review. Change any password that has been shared in chat before provisioning the admin account.
