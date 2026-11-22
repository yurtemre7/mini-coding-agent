# MCA website

Plain static HTML and CSS: no build step, no dependencies, no scripts. Edit `index.html` and `style.css`; preview with `npx serve website`.

## Deploy on Netlify (works with a private repo)
1. Netlify > Add new site > Import an existing project > GitHub. Authorize the Netlify GitHub app and select **only** this repo (private repos are supported on every plan).
2. Settings are read from `netlify.toml` (base `website`, publish `.`, no build command). Click Deploy.
3. Every push to `main` redeploys; pull requests get deploy previews.

Notes:
- The site itself is public even if the repo is private. Do not put anything secret in `website/`.
- Release downloads: a private repo's GitHub Releases are **not** downloadable by visitors. Host the `.dmg` files somewhere public (a public releases repo, or Netlify) and link them from the Install section, or make the repo public.
