# The Vite and Tailwind setup, as used here

Every React app here is Vite plus Tailwind plus TypeScript. Read the actual config before changing
anything — the plugin set and the Tailwind wiring differ between releases.

## Orientation — four files

| File | What it settles |
| --- | --- |
| `package.json` | the scripts CI runs, and which plugins and runner are installed. Read this first |
| `vite.config.ts` | plugins, aliases, dev server and proxy, build options, test config |
| `tsconfig.json` (and its `extends` chain) | strictness and path aliases — `strict` stays on |
| the Tailwind entry | either a `tailwind.config` file with `content` globs, or a CSS-first setup where the theme is declared in the stylesheet. Decides where a design token goes |

## Vite

| Concern | How it works here |
| --- | --- |
| dev server | does **not** type-check: `npx tsc --noEmit`, or the build, is the only type verdict |
| env variables | only the client-prefixed ones reach the bundle; check the prefix in the existing `.env` files |
| env files | `--mode staging` loads `.env.staging` — how a non-production build gets a different API base |
| aliases | declared **twice**: `resolve.alias` in `vite.config.ts` and `paths` in `tsconfig.json` |
| API proxying in development | `server.proxy` — the alternative is a CORS problem the backend does not have in production |
| code splitting | route-level `React.lazy` plus a `Suspense` boundary per route; a static import of a lazy route silently puts it back in the entry chunk: read the build's chunk list |
| assets | a string path in `public/` is not fingerprinted: wrong place for anything cacheable |
| `base` | set it when the app is not served from the domain root, or asset requests are wrong in production only |

Do not add a polyfill without checking the browser target in the Vite config and the browser support
list.

## Tailwind

| Point | Rule |
| --- | --- |
| dynamic class names | the scanner reads source text: a class assembled from a template string produces nothing. Complete class names behind a lookup map |
| conditional classes | a small `clsx`-style joiner, plus a merge helper if variants can conflict |
| repetition | extract a **component**, not an `@apply` layer |
| design tokens | in the theme (config file or CSS theme block, whichever this project uses), never as scattered one-off arbitrary values; three in one component means a missing token |
| resets and global CSS | one entry stylesheet |
| visual and typographic direction | the `frontend-design` plugin's territory |

## Build and verification

```powershell
npm run build              # type-check plus bundle; the only pre-push gate that matters
npm run preview            # serve the built output, so base paths and env modes are exercised
npx vite build --mode staging
npx tsc --noEmit
npm run lint
```

Verify in this order after touching the setup: type-check, build, preview, then the runner. A dev
server that starts proves almost nothing about the production bundle.

## When something works in development and breaks in production

| Symptom | Usual cause |
| --- | --- |
| blank page, asset requests fail | `base` is wrong for the deployment path |
| an env value is `undefined` | missing the client prefix, or the `.env.<mode>` file is not the mode that was built |
| API calls fail with CORS | the dev proxy was doing the work; production needs the real base URL |
| a lazily loaded route is in the entry chunk | a static import of it somewhere |
| a Tailwind class has no effect | built from a template string, or outside the scanned content |
| types were fine, build fails | the dev server never type-checked |
| works only after a hard reload | a cached `index.html` referencing an old hashed chunk — a deployment/cache-header question |
