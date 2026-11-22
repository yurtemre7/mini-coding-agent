# MCA website

Plain static HTML and CSS: no build step, no dependencies, no scripts. Edit `index.html` and `style.css`; preview with `npx serve website`.

## Deploy on Vercel (works with a private repo)
1. Vercel > Add New > Project > Import Git Repository. Install the Vercel GitHub app and select **only** this repo (private repos work on the free Hobby plan for a personal account; Hobby is for non-commercial use).
2. Set **Root Directory** to `website`. Framework Preset: Other. Leave build and install commands empty; `website/vercel.json` sets the output directory and the security headers.
3. Deploy. Every push to `main` redeploys; pull requests get preview deployments.
4. Check the live site: styles and the theme toggle load (the Content-Security-Policy only allows same-origin files), and `curl -I <url>` shows the headers.
5. Move the custom domain, if any, in Vercel > Domains, then update DNS.

### After the migration works
Netlify is still configured until you confirm: `netlify.toml` stays in the repo. Once the Vercel site is live, delete the Netlify site (Site configuration > Delete), revoke the Netlify GitHub app for this repo, and ask for the cleanup commit that removes `netlify.toml`.

Notes:
- The site itself is public even if the repo is private. Do not put anything secret in `website/`.
- Release downloads: a private repo's GitHub Releases are **not** downloadable by visitors. Host the `.dmg` files somewhere public (a public releases repo, or the site itself) and link them from the Install section, or make the repo public.
