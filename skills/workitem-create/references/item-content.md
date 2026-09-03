# Item fields and the create pass

## The body itself belongs to `user-story-standard`

What an item **says** — its type classification, the wording of title and description, and the shape
of the acceptance criteria — is `user-story-standard`'s business, not this skill's. Read it before
writing a body; this page covers only how that body reaches the board.

Two constraints stay here: the long fields are written as **HTML**, because board markdown rendering
is inconsistent, and their prose is **Italian**. Images stay numbered placeholders
(`📎 IMAGE 1 — <caption> (attach manually)`) wherever the standard puts content.

## Fields — set only what the type has

The field set is **per work item type and per process**, so it is discovered, never assumed: read
the type metadata at gate 4 (through `azdo-cli`) and set only fields that exist on that type.
Setting one field that does not exist **fails the entire create**, not just that field.

| Field | Note |
| --- | --- |
| Title | always |
| Description | always; HTML |
| Acceptance criteria | not on every type or process — fold into the description when missing |
| Repro steps | Bug-flavoured types only; same fallback |
| Tags | safe, but only if the board actually uses tags |
| Area / Iteration | inherit from the parent — do not set them by hand unless the user asks |
| State | `New` unless the user says otherwise, or the type starts elsewhere (see below) |
| Assigned to | empty unless asked; resolve the identity at runtime, never hardcode an account |
| Priority / Severity | only when discovery confirms the field and the user asked for a value |

## Create order

Sequential, parents before children, one item at a time:

1. **Root under an existing parent** — prefer the single call that creates the item and its parent
   link atomically; otherwise create, then add the parent relation as a second call.
2. **Root with no parent** — one create with every supported field.
3. **Children** — create against the parent id returned by the previous step. Never guess an id.
4. **Extra fields** the create call could not carry — a follow-up update on the new id.

Parallelism is not the default. Only a large batch with genuinely **independent subtrees** justifies
it (at most four in flight), and parent-before-child still holds inside each subtree.

## Safeguards

1. **First create against an untouched project in this session**: create **one** item, show the
   result, then continue with the rest. A wrong field or a wrong project shows up on item 1 rather
   than on item 12.
2. **Mid-batch failure**: stop, report the **ids already created**, and say exactly which rows
   remain. A retry must never duplicate.
3. **State correction**: if the type's initial state is not `New`, or the user asked for another
   state, set it explicitly right after the create and say so.
4. **Read back before the summary**: re-read every created item and confirm type, parent, state and
   the fields that were set. The summary reports what the board says, not what the calls returned.
5. **Never create a test item** on a real board — not to probe a field, not to check a permission.
   Probe with a read.

## Images and attachments

The CLI has no attachment verb, so images are handled as **numbered placeholders plus a manual
checklist** by default. If the connected MCP server exposes a work item attachment capability, it
may be used as the fallback — check what the server actually exposes rather than assuming, and keep
the checklist for whatever was not uploaded. Either way the user is told which images are still
missing from which item.

## Traps

1. One bad field name kills the whole create → the field set was assumed → read the type metadata.
2. HTML written into a field that expects plain text → tags show up literally → HTML for description
   and criteria; plain text for titles and tags.
3. Acceptance criteria silently dropped → the type has no such field → fold them into the
   description under their own heading, and say so in the summary.
4. Area and Iteration set explicitly and wrongly → they were copied from another item → let them
   inherit from the parent.
5. Children created before the parent id is known → placeholder ids get invented → sequential
   creation exists for this reason.
6. Items look right in the call responses but wrong on the board → the response was trusted → read
   the items back.
