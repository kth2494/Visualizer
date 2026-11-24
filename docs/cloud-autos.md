# Cloud autos setup

Cloud autos work only on the Vercel deployment. The two functions in `api/` hold the secrets.

1. Sign up at https://liveblocks.io.
2. Create a project and copy its **Secret key** (`sk_...`). You'll find it under API keys.
3. In Vercel, open the project's **Settings → Environment Variables** and add these two variables:
   - `LIVEBLOCKS_SECRET_KEY`: the secret key.
   - `TEAM_PASSWORD`: the password your team types once per browser.
4. Redeploy. Environment variables only apply to new deployments.
5. On the site, open **File → Cloud autos…**, enter the password and your name, then use **Upload current**.

Opening an auto adds `?auto=…` to the address. Send that link to a teammate to open the same auto.

To change the password, change `TEAM_PASSWORD` and redeploy. Each browser then asks for the new password.
