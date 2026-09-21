# Screenshots and evidence

## What earns a screenshot

One screenshot per KO **where the failure is visible**. That is the whole rule, and both halves
matter.

| The KO is                                                        | Screenshot? |
| ---------------------------------------------------------------- | ----------- |
| Visual: wrong layout, wrong colour, a control in the wrong place, an element missing from a view | yes |
| Already proven by prose: a missing label, a wrong string, a count from a page-wide text search | no |
| Behavioural: a click that does nothing, a navigation that never happens | no — the marker probe or the network log is the proof |
| An AC that passes                                                 | no          |

**Do not manufacture images to look thorough.** An item whose KO are all prose-provable produces a
comment with no images at all, which is the *better* outcome: it can go through the comment API in
one call instead of being typed into a browser form.

## Crop to the region that matters

A full-page shot of a header bug spends the reader's attention on nine hundred pixels of hero image.
Playwright takes an element screenshot by targeting the element; the extension can capture a
rectangle. Either way, frame the thing that is wrong, plus enough surrounding context to make the
location obvious.

Where a comparison is the point — the mockup shows a round flag, the site renders a square one —
crop both to the same region so they can be read side by side.

## Where the files have to live

Every file you intend to attach must sit in a directory this session may read. **The working
directory is safe**, and a relative subfolder such as `.qa-evidence` keeps a run's evidence
together.

| Tool                    | Writes to                                              | Consequence                                    |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Playwright              | the working directory                                   | nothing to do                                   |
| The browser extension, saving to disk | its own temp folder, **outside** the roots the upload accepts | copy the file into the working directory first, or the upload is rejected |

This is a silent failure: the capture succeeds, the path looks fine, and the upload refuses it. Copy
first, then upload.

## Timing

A screenshot taken one second after opening a menu often catches it mid-transition, and a
half-open menu in a KO screenshot reads as an unrelated rendering bug. Wait for the animation to
settle, then shoot. Where the page has an explicit loading state, wait for it to disappear rather
than waiting a fixed interval.

Right after an attachment upload, a screenshot call can time out while the editor is busy. The page
is fine — a script evaluation still answers. Wait and retry the screenshot; **do not re-upload**,
that duplicates the image in the comment.

## Naming

Name each file after the AC it proves and the context it was taken in, so the caption and the file
agree and a reader who downloads three attachments can still tell them apart:

```
.qa-evidence/AC03-desktop-header-flag.png
.qa-evidence/AC07-mobile-menu-missing-entry.png
```

## Evidence that is not an image

Prefer these where they apply — they are shorter, they are re-checkable, and they survive being
pasted into a comment:

| Evidence                                    | Proves                                        |
| ------------------------------------------- | --------------------------------------------- |
| A page-wide text search with counts          | a string is absent, or present with wrong case |
| The element's outer HTML, trimmed            | a control is a dead link with no handler       |
| A computed style value                       | it is hidden, mis-sized or mis-coloured        |
| A bounding rectangle                         | it is off-screen or overlapping                |
| A failed request's method, path and status   | the UI is empty because the call failed        |
| A console error, verbatim                    | the feature throws before it renders           |

Quote these inline in the KO bullet. A KO that carries one exact quoted fact is stronger than a KO
that carries a picture, because the developer can re-run it without opening a browser.
