# Reading a dump

Last resort: expensive to collect (the process stops, the file is heap-sized) and slow to read. Reach
for it when counters, stacks and traces have not answered.

## Collect

```powershell
dotnet-dump collect -p <pid> -o .\proc.dmp                  # full, the default
dotnet-dump collect -p <pid> --type Heap -o .\heap.dmp      # smaller: heap without full memory
dotnet-dump collect -p <pid> --type Mini -o .\mini.dmp      # stacks only, useful for a hang
```

Collect where the process runs. A Linux-container dump reads on Windows with the analysis tool, not
with every native debugger: prefer the tool. For an intermittent crash, configure a **dump on crash**
through the runtime's dump environment variables — the only reliable evidence of a weekly crash.

## Analyze

`dotnet-dump analyze .\proc.dmp` opens a shell with SOS loaded. Non-obvious commands:

| Command | Answers |
|---|---|
| `clrstack -all` | every managed stack — first read for a hang; `clrstack -a` adds arguments and locals |
| `pe` | the current thread's exception with inner exceptions |
| `dumpasync` | pending async state machines — in async code the interesting work is on no thread stack |
| `syncblk` | monitor locks and owners: the deadlock finder |
| `threadpool` | queue length, worker and completion-port counts |
| `dumpheap -stat` / `-type <Name>` | heap by type (read the bottom: largest total, then count) / instances with addresses |
| `gcroot <address>` | **why** an object is alive — the retention path (static field, event handler, cache, captured context) |
| `objsize <address>` | what one object really retains |
| `eeheap -gc` | generation sizes; large-object heap growth |

`help <command>` gives the syntax, which differs per tool version.

**Hung:** `clrthreads`, `clrstack -all`, group identical stacks; `syncblk` for a monitor owned by a
thread that is itself blocked (deadlock); `dumpasync`. Idle threads plus thousands of pending
continuations means the awaited thing never completes.

**Memory:** `dumpheap -stat`, take the suspicious type, `gcroot` an instance.

**Threw:** `clrthreads` shows the pending exception; `setthread` to it, `pe`, and read the inner chain to
the bottom — the outermost message is usually the least useful.

## Symbols

Without symbol files you still get type and method names. Fetch runtime symbols with `dotnet-symbol`;
keep your own build's symbols as pipeline artefacts — a release built months ago cannot be re-created
byte-identically, so unkept symbols mean line numbers are gone for good.

## Alternatives that are sometimes faster

| Instead of a dump | When |
|---|---|
| `dotnet-stack report` | only stacks are needed and the process may keep running |
| `dotnet-gcdump` | a memory question: a few MB instead of GB, safe on a live process, and diffing two beats reading one dump |
| a native debugger with SOS | native frames, or a corrupted runtime |

## Handling

- A dump holds connection strings, tokens, session data and customer records in clear bytes: it is a
  secret. Never in the repository, never attached to a work item or PR; delete it when done.
- Record pid, timestamp, build identifier and load conditions beside the file.
- Extract the findings (grouped stacks, heap statistics, retention path) before deleting.
