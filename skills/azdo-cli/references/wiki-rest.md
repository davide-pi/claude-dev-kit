# Project wiki — read with the CLI, write with REST

Two verified defects decide the split: the CLI's page **writes** corrupt accented characters on
Windows, and the CLI has no way to list a page tree. Reads of a single page and of the wiki list are
fine on the CLI; everything else goes through REST with the same `az login` credential.

| Operation | Route | Why |
| --- | --- | --- |
| List the wikis of a project | `az devops wiki list` | works |
| Read one page at a known path | `az devops wiki page show` | works |
| List the page tree / subpages | **REST** `pages?recursionLevel=full` | no `list` verb exists |
| Create or update a page | **REST** `PUT` with `charset=utf-8` | the CLI mangles accents |
| Delete a page | `az devops wiki page delete` | works; irreversible, confirm first |

## Trap 1 — `page create` and `page update` corrupt accented characters

Reproducible, not a one-off: the CLI re-reads the page content in the **system codepage** instead of
UTF-8, so every accented character lands as a replacement glyph and the page has to be rewritten by
hand. It affects `--content` and `--file-path` alike. Use the REST `PUT` below for any write that
touches text — which in practice is every write.

## Trap 2 — `az devops wiki page` has no `list` verb

`show` reads the page at one path and does **not** return its children, despite a `subPages` field
appearing in the output. There is no verb that walks the tree. The whole tree is only reachable
through REST with `recursionLevel=full`, so any "which pages exist" question starts there.

## The token, once per session

```powershell
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 `
  --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token" }
$wiki = "https://dev.azure.com/<org>/<project>/_apis/wiki/wikis/<wiki>"
```

`499b84ac-1321-427f-aa17-267ca6975798` is the fixed Azure DevOps AAD resource id — the same in every
organization. The organization and the project in that URL come from the resolution rule in the
skill body, never from a default. Get the wiki's own name from `az devops wiki list`; a project wiki
is normally the project name with hyphens plus a `.wiki` suffix, but read it rather than assume it.

Every path segment is url-encoded — `[uri]::EscapeDataString($path)` — and so is a project name
containing spaces.

## Read the whole tree

```powershell
$r = Invoke-RestMethod -Method Get -Headers $headers `
  -Uri "$wiki/pages?path=%2F&recursionLevel=full&api-version=7.1"
$r | ConvertTo-Json -Depth 10
```

## Read one page with its content

```powershell
$p = [uri]::EscapeDataString('/<page-path>')
$page = Invoke-RestMethod -Method Get -Headers $headers `
  -Uri "$wiki/pages?path=$p&includeContent=true&api-version=7.1"
$page.content
```

The equivalent CLI read is `az devops wiki page show --path '/<page-path>' --include-content`, which
is safe: only the write direction has the encoding defect.

## Create a page

```powershell
$p = [uri]::EscapeDataString('/<page-path>')
$content = @"
# <heading>

<body text, accents included>
"@
$body = @{ content = $content } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Put -Uri "$wiki/pages?path=$p&api-version=7.1" `
  -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8'
```

`charset=utf-8` on the content type is the whole point — without it the payload is re-encoded and the
accents are lost again. No `If-Match` is needed when the path does not exist yet: the `PUT` creates
it. The response carries `eTag` and `page.gitItemPath` (spaces replaced by hyphens) — keep the
`eTag` for a later update.

Content prepared in a local file must be read with the encoding stated explicitly, or the corruption
happens before the request is even built:

```powershell
$content = Get-Content -Raw -Encoding UTF8 '<local-draft-file>'
```

## Update a page — the eTag discipline

An update needs the page's **current** `eTag`, from the most recent read or write of that page:

```powershell
$page = Invoke-RestMethod -Method Get -Headers $headers `
  -Uri "$wiki/pages?path=$p&includeContent=true&api-version=7.1" -ResponseHeadersVariable h
$headers['If-Match'] = $h.ETag[0]
$body = @{ content = $newContent } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Put -Uri "$wiki/pages?path=$p&api-version=7.1" `
  -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8'
```

A stale `eTag` means somebody else changed the page since you read it, and the call fails on
purpose. **Never force a stale eTag** and never drop `If-Match` to get past it: re-read the page,
take the new `eTag`, re-apply the change on top of the current content, and retry. Forcing it
overwrites the other person's edit silently.

## Always read the page back

After any create or update, re-read the page (the read above) and check the accented characters with
your own eyes before calling the step done. It is the only reliable way to catch a corrupted write
immediately instead of discovering it days later, and it costs one call.
