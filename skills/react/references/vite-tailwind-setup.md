# The Vite and Tailwind setup, as used here

Every React app here is Vite plus Tailwind plus TypeScript. Read the actual config before changing
anything — the plugin set and the Tailwind wiring differ between releases, and the files tell you
which arrangement this project uses.

## Orientation — four files

| File | What it settles |
| --- | --- |
| `package.json` | the scripts CI runs, and which plugins and runner are installed. Read this first, always |
| `vite.config.ts` | plugins, aliases, dev server and proxy, build options, test config if the runner shares it |
| `tsconfig.json` (and its `extends` chain) | strictness and path aliases — see `typescript` |
| the Tailwind entry | either a `tailwind.config` file with `content` globs, or a CSS-first setup where the theme is declared in the stylesheet. Which one you have decides where a design token goes |

If a `tailwind.config` file exists, the `content` globs decide what is scanned. If it does not, look
for the Tailwind import and theme declarations in the main stylesheet, and for a Tailwind entry in
`vite.config.ts`'s plugin list.

## Vite

| Concern | How it works here |
| --- | --- |
| dev server | fast because it does **not** type-check. `npx tsc --noEmit`, or the build, is the only type verdict |
| env variables | only the client-prefixed ones are exposed to the bundle; everything else stays server-side. Check the prefix convention in the existing `.env` files |
| env files | `.env`, `.env.local` (git-ignored), `.env.<mode>`. `--mode staging` loads the staging file — this is how a non-production build gets a different API base |
| aliases | must be declared **twice**: `resolve.alias` in `vite.config.ts` and `paths` in `tsconfig.json`. One without the other gives either a broken build or broken editor navigation |
| API proxying in development | `server.proxy` — the alternative is a CORS problem the backend does not have in production |
| code splitting | route-level `React.lazy` plus dynamic `import()`; a `Suspense` boundary per route with a real fallback |
| chunk inspection | run the build and read the emitted chunk list; a static import of a lazily loaded route silently puts it back in the entry chunk |
| assets | imported assets are hashed and rewritten; a string path in `public/` is served as-is and is not fingerprinted, so it is the wrong place for anything cacheable |
| `base` | set it when the app is not served from the domain root, or every asset request is wrong in production only |

Do not add a bundler plugin to solve something the config already covers, and do not add a polyfill
without checking the browser target — that target lives in the Vite config and the browser support
list, not in memory.

## Tailwind

| Point | Rule |
| --- | --- |
| dynamic class names | the scanner reads source text — a class assembled from a template string produces nothing. Use complete class names behind a lookup map |
| conditional classes | a small `clsx`-style joiner, plus a merge helper if variants can conflict. Do not concatenate strings by hand |
| repetition | extract a **component**, not a CSS abstraction layer. A component is typed, testable and composable; an `@apply` soup is none of those |
| design tokens | colours, spacing and fonts belong in the theme (config file or CSS theme block, whichever this project uses), never as one-off arbitrary values scattered through markup |
| arbitrary values | fine occasionally, a smell in bulk — three of them in one component means a missing token |
| long class lists | expected, and not a problem worth solving with abstraction. Sort them consistently (the official sort plugin, if installed) so diffs stay readable |
| dark mode / responsive | variant prefixes, in one place per component; not duplicated markup |
| resets and global CSS | one entry stylesheet. A second global stylesheet is how specificity fights start |
| visual and typographic direction | the `frontend-design` plugin's territory, not this skill's |

## Build and verification

```powershell
npm run build              # type-check plus bundle; the only pre-push gate that matters
npm run preview            # serve the built output, so base paths and env modes are exercised
npx vite build --mode staging
npx tsc --noEmit
npm run lint
```

Verify in this order after touching the setup: type-check, build, preview, then the runner. A dev
server that starts proves almost nothing about the production bundle — different transforms, different
env, different asset paths.

## When something works in development and breaks in production

| Symptom | Usual cause |
| --- | --- |
| blank page, asset requests fail | `base` is wrong for the deployment path |
| an env value is `undefined` | missing the client prefix, or the `.env.<mode>` file is not the mode that was built |
| API calls fail with CORS | the dev proxy was doing the work; production needs the real base URL |
| a lazily loaded route is in the entry chunk | a static import of it somewhere |
| a Tailwind class has no effect | built from a template string, or outside the scanned content |
| types were fine, build fails | the dev server never type-checked |
| something works only after a hard reload | a cached `index.html` referencing an old hashed chunk — a deployment/cache-header question, not a code one |
