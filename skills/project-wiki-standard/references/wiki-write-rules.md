# Writing to the wiki: target, encoding, concurrency

Two things are easy to get wrong and expensive to notice late: writing to the **wrong client's**
wiki, and writing Italian text that arrives corrupted. Both are behaviour rules, not commands — the
commands themselves belong to `azdo-cli`.

## 1. Resolving the target from the working directory

| Question | Answer |
| --- | --- |
| Which organization and project? | resolved from the **current working directory**, matched against the workspace-to-platform mapping in the user's `CLAUDE.md`, on the root of the path (the mapping holds for every subfolder and repository below it) |
| Directory not in the mapping? | **ask.** Do not guess an org from a repository name, a remote or a previous session |
| Directory not under a workspace at all? | ask which Azure DevOps project the wiki belongs to |
| Can `az devops configure --defaults` be used? | **no.** It is machine-wide and may still point at a previous session's client. Reading `--list` is fine as information; it is never the target |
| How are they passed? | explicitly on every call — the org in the URL for a REST call, `--org` and `-p` for a CLI call |
| Which wiki inside the project? | list the project's wikis (`azdo-cli`) and take the name from the result; a project wiki is usually the project name with hyphens plus a `.wiki` suffix, but confirm it instead of composing it |

State the resolved organization, project and wiki back to the user before the first write. A wrong
target is not recoverable by editing: the content ends up in someone else's wiki history.

## 2. What `azdo-cli` owns

Route to it by name; do not restate its syntax here. It holds:

- the access token for REST calls against Azure DevOps, and the header shape;
- reading the **page tree** with `recursionLevel=full` — the only way to see the tree, because
  `az devops wiki page` has no `list` verb and `show` returns a `subPages` field without content;
- reading a single page with its content and its eTag, url-encoding the path;
- creating and updating a page with the **REST PUT** and `charset=utf-8`.

## 3. Encoding: never the plain CLI on accented content

`az devops wiki page create` and `az devops wiki page update` re-read the content with the system
codepage instead of UTF-8 on Windows and corrupt every accented character. This wiki's content is
Italian, so the consequence is absolute:

- **Every** page write goes through the REST PUT with `charset=utf-8`. No exception for a page that
  "looks like it has no accents" — the next edit will add one.
- The plain CLI is fine only for read-only operations that touch no accented text: listing wikis,
  checking the login.
- Content prepared in a local file is read with an explicit UTF-8 encoding, or the corruption is
  introduced before the call is even made.
- **Read the page back after every write** and check the accents survived. Pick two or three
  accented words actually present in what was written and confirm they are there, and that the read
  content contains no replacement character. This is the only reliable way to catch a corrupted
  write immediately instead of discovering it weeks later, and no step's **Completo quando:** gate
  is satisfied without it.

## 4. Concurrency: the eTag discipline

An update sends the eTag of the version it is editing, in `If-Match`. The rules:

| Situation | Rule |
| --- | --- |
| Creating a page that does not exist | no `If-Match` — the PUT creates the path |
| Updating a page | use the eTag from the **last** read or write of that page, never an older one |
| The call fails on a mismatch | somebody changed the page meanwhile: **re-read**, take the current eTag, re-apply the edit on top of the new content, retry |
| Tempted to force it | never. Forcing a stale eTag discards someone else's edit, which is exactly what the check exists to prevent |

A retry always re-applies the edit to the freshly read content. Re-sending the old body with a new
eTag is the same overwrite with extra steps.

## 5. What this skill never does

- Never writes to a repository: no source file, no docs tree, no commit. A repository's own
  documentation belongs to `doc-keeper`.
- Never deletes or moves a page without page-by-page confirmation from the user.
- Never removes content from a source page before the destination page has been written and read
  back.
- Never invents client facts, contacts, constraints or decisions to fill a placeholder. An empty
  placeholder that is reported as empty is correct; a plausible invention is not.
- Never fills `Chiusura progetto` unless it was explicitly asked for.
- Never takes its organization or project from the CLI defaults.
