# Driving the browser

## One driver: `browser-use` on the real Edge profile

The plugin attaches over CDP to the user's own Edge (the `ensure-edge-cdp` hook starts it if
closed): already authenticated, visible to the user, and scriptable — one `browser-use` heredoc runs
a whole sequence of steps and prints only what you ask for, which is far cheaper than one tool call
per click.

- First navigation is `new_tab(url)`; **never drive tabs the user opened**, reuse your own tab for
  the rest of the run, and close the tabs you created at the end unless the user wants to look.
- A login wall → the user signs in themselves in that tab; passwords are never typed.

**Viewports by emulation, not by resizing.** A window resize on a maximised window is silently
ignored; CDP emulation is exact and reproducible:

```python
cdp('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=3, mobile=True)
print(js('[window.innerWidth, window.innerHeight]'))   # read it back before trusting it
# ... checks for this viewport ...
cdp('Emulation.clearDeviceMetricsOverride')            # always restore the user's tab
```

Locales and country parameters: change the URL or `cdp('Emulation.setLocaleOverride', locale=...)`
in the same script, one loop over the matrix.

## Deciding the test matrix

The user's `[viewport]` argument wins. Otherwise deduce, in this order:

1. **The item text.** "on desktop", "on mobile", "when the user opens the menu" — the AC usually say
   where they apply.
2. **The running page.** Responsive branches are visible from the browser: utility classes that hide
   an element at a breakpoint, `@media` rules in the stylesheets, `<picture>`/`srcset`, or two
   separate DOM subtrees for a mobile and a desktop navigation. Each distinct branch is a layout
   somebody has to test.

```js
[...document.querySelectorAll('nav *')]
  .filter(e => /(^|\s)(xl:|lg:|md:|sm:)?hidden/.test(e.className || ''))
```

Then pick one width per branch — 1440x900 desktop, 768x1024 tablet, 390x844 mobile are sane
defaults. **Say in the chat report which viewports ran**; the reader needs to know the coverage.

## While testing

- **Reject the cookie banner as soon as it appears.** It can come back after every navigation, and
  declining non-essential cookies is both the privacy-preserving choice and what unblocks the UI.
- **Prove behaviour, do not photograph it.** A screenshot shows a button; it does not show that the
  button does nothing. Reach for the DOM whenever a claim needs proof: is the control a real handler
  or a dead `<a href="">`? Did the click navigate at all?
- **The cheap decisive trick for "nothing happened":** set `window.__probe = 1`, click, read it
  back. If the marker survived, there was no navigation, so a click that appeared to do nothing
  really did nothing.
- **Console and network explain failures the UI only hints at.** A missing label with a 500 on the
  translations request is a different bug from a missing label with a clean network log.
- **Re-check each AC on a page other than the home page** when it says "on any page".
- **Verify computed styles, not source CSS**, for anything about size, colour, position or
  visibility — the cascade is the thing the user gets.

```js
getComputedStyle(document.querySelector('<selector>')).getPropertyValue('display')
document.querySelector('<selector>').getBoundingClientRect()
[...document.querySelectorAll('<selector>')].length     // a count is evidence a text search can quote
```

A text search over the whole page is one of the strongest KO proofs available, because it is
re-checkable in seconds: "`Change Language` → 0 occurrences, `Change country` → 1, with a lowercase
c" beats any screenshot.

## When you get stuck

A tool failing two or three times, a page that stops responding, an unexpected modal: **stop and ask
the user** instead of grinding. Say what you tried and what happened. Grinding produces a verdict
built on a half-loaded page, which is exactly the failure the review tag cannot catch.
