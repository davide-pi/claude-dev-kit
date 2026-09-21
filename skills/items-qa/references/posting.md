# Posting the verdict

One comment per item, posted directly — no confirmation gate, that is what the tag is for.

**Decide the route before writing a word**, on one question: *does this comment carry screenshots?*
There is no way to attach an image to a comment that has already been posted, so a route chosen
halfway through means retyping the whole thing.

## No screenshots → the comment API

The work-item comment write capability, adding a comment in Markdown. Prefer it whenever it
suffices: one call, no rich-text editor to fight, nothing left half-written. A comment needs no
images when every KO is provable in prose — a missing label, a wrong string, a count from a text
search — or when there are no KO at all.

## Screenshots → upload them first, then still post through the API

The MCP cannot *create* an attachment; its attachment tool only downloads one. But a Markdown
comment renders an image fine as long as the attachment already exists:

```
![AC03 desktop header](https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{id}?fileName=x.png)
```

That is exactly the shape Azure DevOps itself writes into item descriptions. So try the API route
before reaching for the browser:

```powershell
# 1. a token — pick ONE, whichever this session actually has
#    an existing personal access token…
$h = @{ Authorization = "Basic " + [Convert]::ToBase64String(
        [Text.Encoding]::ASCII.GetBytes(":$env:AZURE_DEVOPS_EXT_PAT")) }
#    …or the signed-in az identity (that guid is the Azure DevOps resource id)
$h = @{ Authorization = "Bearer " + (az account get-access-token `
        --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv) }

# 2. PROBE that this identity can reach this organisation — do NOT skip this
az devops project list --organization "https://{org}.visualstudio.com" --query "value[0].name" -o tsv

# 3. upload, and keep the .url from the response
Invoke-RestMethod -Method Post -Headers $h -ContentType "application/octet-stream" `
  -Uri "https://dev.azure.com/{org}/{project}/_apis/wit/attachments?fileName=shot.png&api-version=7.1" `
  -InFile ".\.qa-evidence\AC03-desktop-header-flag.png"
```

The probe matters because failure here is **quiet**: a token for the wrong tenant returns a
not-authorized error, and a REST call against an organisation the identity cannot see returns an
HTML sign-in page, which surfaces only as "not a json response". One organisation being reachable
says nothing about the next one — see `azdo-cli` for the multi-tenant token rules.

## Upload unavailable → the Discussion editor in the browser

Then the **whole** comment goes through the form. This step belongs to the browser extension even
when the test ran entirely in Playwright, because Azure DevOps needs the user's authenticated
session and a fresh Playwright profile does not have one.

1. Open `https://{org}.visualstudio.com/{project}/_workitems/edit/{id}` in a tab **you created**.
2. Find the file input for attachments. Three refs come back — for the **Description**, the
   **Acceptance Criteria** and the **Discussion**. Take the Discussion one: uploading into either of
   the others edits the item body, which rule 4 forbids.
3. Click the Discussion textbox and type the text down to the first screenshot's caption.
4. Upload that screenshot onto the Discussion ref — it lands inline at the caret.
5. **Before typing again, re-focus the editor and collapse the caret to the end**, or the next
   sentence lands in the wrong place:

   ```js
   const ed = [...document.querySelectorAll('[contenteditable=true]')]
     .find(e => e.getAttribute('aria-label') === 'Discussion');
   ed.focus();
   const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
   const s = getSelection(); s.removeAllRanges(); s.addRange(r);
   ```

6. Repeat caption → upload for each screenshot.
7. Before saving, confirm every image resolved to a real attachment URL:
   `[...ed.querySelectorAll('img')].map(i => i.src)` — each one should point at an attachments API
   path. An image still on a blob or data URL has not been uploaded and will save as nothing.
8. Click **the comment's own Save**, inside the Discussion box — not the work item Save in the
   toolbar. The toolbar save commits field edits, which rule 4 forbids.

Right after an upload the screenshot tool can time out while the editor is busy. The page is fine —
a script evaluation still answers. Wait and retry the screenshot; do not re-upload, that duplicates
the image.

Close the tabs you created when you are done, unless the user wants to keep looking at them.

## When a visual KO ends up without its screenshot

The browser is unavailable, the upload was refused, the form misbehaved. **Post through the API
anyway** rather than losing the whole run, and say in chat that it went out without images. A KO the
reader cannot see is weaker, and they should learn that from you rather than assume the screenshots
are there.

## After posting

| Fact                                                            | Consequence                                            |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Comments cannot be deleted through the API                       | a wrong comment has to be removed by hand in the web UI |
| Posting has no confirmation gate                                  | rule 2 is the only protection: verify before it goes out |
| The comment is the deliverable, the chat report is the summary    | never post something the chat report contradicts        |

Report the link to each posted comment in chat, so the user can open what was written without
hunting for the item.
