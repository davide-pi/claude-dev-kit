# Work item content — the fields a type really has, and images

Two things make a created item look empty on the board even though the call succeeded: the text went
into a field the type's form does not show, and the image went into the Attachments tab. This file
covers both, plus the attachment REST path that the CLI reaches without a PAT.

## 1. Discover the fields before writing them

A process is customised per organization. Reference names like `Custom.<Something>` exist in one
organization and not in the next, and a native field can be **relabelled** on the form, so the label
you read in the browser is not the field you write. Never carry a field reference name over from
another organization or from another project's notes — resolve it at runtime.

```powershell
# Cheapest and always available: read an item of that type that already has content, and look at
# which reference names actually carry it. Custom fields show up as `Custom.*`.
az boards work-item show --id <an-existing-item-of-that-type> --expand all `
  --query "fields | keys(@)" -o tsv

# Authoritative: the project's field catalogue, filtered by the label you saw on the form.
az devops invoke --area wit --resource fields --route-parameters project=<project> `
  --query "value[?contains(name, '<label-fragment>')].{label:name, ref:referenceName, type:type}" -o table
```

Confirm the `--area`/`--resource` names in the `az devops invoke` listing (see
`auth-and-config.md`) rather than trusting the spelling above; a per-type field set is the one thing
neither route returns cleanly, and that is the MCP work-item-type read (`mcp-fallback.md`).

## 2. A Bug has no Description field on a Scrum form

Writing the text into `System.Description` on a Bug is the classic silent failure: the call
succeeds, the field is not on the form, and the item reads as empty in board and backlog. On a Scrum
process the Bug form carries three text fields instead:

| Label on the form | Reference name | Nature |
| --- | --- | --- |
| Repro Steps | `Microsoft.VSTS.TCM.ReproSteps` | native |
| Actual result | a **custom** field of that organization | discover it — section 1 |
| Expected result | `Microsoft.VSTS.TCM.SystemInfo` | native **System Info**, relabelled on the form |

The third row is the reason section 1 is not optional: a relabelled native field is invisible to
anyone reading the form, and only a field-list query connects the label to the reference name.
None of the three is mandatory — pass only the ones that have content.

```powershell
az boards work-item create --org <org-url> -p <project> --type 'Bug' --title '<title>' `
  --fields 'Microsoft.VSTS.TCM.ReproSteps=<steps>' '<actual-result-field-ref>=<actual>' `
           'Microsoft.VSTS.TCM.SystemInfo=<expected>'
```

The same holds in reverse: the types whose form *does* show Description take `--description`
normally. Check the form's field set once per project and per type, then reuse the answer.

## 3. Attachments — the CLI reaches them, in two REST steps

`az boards` has no attachment verb, but this is **not** a gap: the bearer token of the current
`az login` is enough, so no PAT and no MCP tool are needed. The Azure DevOps AAD resource id
`499b84ac-1321-427f-aa17-267ca6975798` is a fixed constant — identical across every organization.

```powershell
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 `
  --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token" }
$base = "https://dev.azure.com/<org>/<project>/_apis/wit"

# Step 1 — upload the bytes. The file is not attached to anything yet; the response carries its URL.
$file = '<path-to-file>'
$name = [uri]::EscapeDataString((Split-Path $file -Leaf))
$up = Invoke-RestMethod -Method Post -Uri "$base/attachments?fileName=$name&api-version=7.1" `
  -Headers $headers -ContentType 'application/octet-stream' -InFile $file
$up.url

# Step 2 — attach it to the work item with a JSON-Patch `AttachedFile` relation.
$patch = ,@{ op = 'add'; path = '/relations/-'; value = @{
    rel = 'AttachedFile'; url = $up.url; attributes = @{ comment = '<optional>' } } } |
  ConvertTo-Json -Depth 6 -AsArray
Invoke-RestMethod -Method Patch -Uri "$base/workitems/<id>?api-version=7.1" `
  -Headers $headers -ContentType 'application/json-patch+json' -Body $patch
```

`-InFile` is what keeps the upload binary-safe — a body built as a string corrupts anything that is
not text. `-AsArray` is what keeps the patch document an array: a one-element array serialises to a
bare object without it, and the endpoint rejects that. Repeat both steps once per file.

## 4. On a Bug, the image goes inline in the field — not as a relation

An `AttachedFile` relation only surfaces in the Attachments tab, which nobody opens: the image is
effectively invisible. For a Bug, put it **inline in the field it belongs to** — the actual-result
image in the actual-result field, the expected-result image in `Microsoft.VSTS.TCM.SystemInfo`.

Step 1 of section 3 is still needed, purely to obtain the attachment URL. Step 2 is not: skip the
relation and patch an `<img>` into the field's **existing** HTML instead.

```powershell
$field = '<field-reference-name>'
$current = az boards work-item show --id <id> --query ('fields."{0}"' -f $field) -o tsv
$html = "$current<div><img src=`"$($up.url)`" alt=`"<short-description>`" /></div>"
$patch = ,@{ op = 'replace'; path = "/fields/$field"; value = $html } |
  ConvertTo-Json -Depth 4 -AsArray
Invoke-RestMethod -Method Patch -Uri "$base/workitems/<id>?api-version=7.1" `
  -Headers $headers -ContentType 'application/json-patch+json' -Body $patch
```

Two rules: **append, never replace blind** — read the field first, or the patch wipes the text that
is already there; and `op: replace` needs the field to exist on the item already, so use
`op: add` when the field has never been written. Do it once per image, in the matching field.
