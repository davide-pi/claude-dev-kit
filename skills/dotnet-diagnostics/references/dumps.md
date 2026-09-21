# Reading a dump

A dump is the whole process frozen: every thread, every object, every lock. It is the last resort
because it is the most expensive to collect (the process stops, and the file is heap-sized) and the
slowest to read. Reach for it when counters, stacks and traces have not answered.

## Collect

```powershell
dotnet-dump collect -p <pid> -o .\proc.dmp                  # full, the default
dotnet-dump collect -p <pid> --type Heap -o .\heap.dmp      # smaller: heap without full memory
dotnet-dump collect -p <pid> --type Mini -o .\mini.dmp      # stacks only, useful for a hang
```

Collect on the machine and platform where the process runs. A dump from a Linux container read on
Windows works with the analysis tool but not with every native debugger, so prefer the tool.

Configure a **dump on crash** through the runtime's dump environment variables when the failure is
intermittent and you cannot be there for it. That is the only reliable way to get evidence of a crash
that happens once a week.

## Analyze

```powershell
dotnet-dump analyze .\proc.dmp
```

That opens a shell with SOS loaded. The commands that matter, in the order you use them:

| Command | Answers |
|---|---|
| `clrthreads` | how many threads, which are running, which hold locks |
| `clrstack -all` | every managed stack — the first thing to read for a hang |
| `clrstack -a` | the current thread's stack **with arguments and locals**: the actual values |
| `pe` | print the current exception on this thread, with its inner exceptions |
| `dumpasync` | pending async state machines — the async equivalent of a stack, essential here |
| `syncblk` | monitor locks and who owns them: the deadlock finder |
| `threadpool` | queue length, worker and completion-port counts |
| `dumpheap -stat` | every type on the heap by count and total size, ascending |
| `dumpheap -type <Name>` | the instances of one type, with addresses |
| `gcroot <address>` | **why** an object is still alive — the retention path |
| `dumpobj <address>` | one object's fields |
| `objsize <address>` | that object plus everything it retains |
| `eeheap -gc` | segments and generation sizes; large-object heap growth shows here |
| `dumpdomain`, `clrmodules` | which assemblies and versions are actually loaded |
| `setthread <n>` | switch thread, then re-run the stack commands |
| `help <command>` | the syntax, which differs slightly per tool version |

## The three questions a dump usually answers

**Why is it hung.** `clrthreads`, then `clrstack -all`, then group the identical stacks. Then
`syncblk` to see whether a monitor is owned by a thread that is itself blocked — that pair is a
deadlock. Then `dumpasync`, because in async code the interesting work is not on any thread stack: it
is a suspended state machine waiting on something. A hang with idle threads and thousands of pending
async continuations means the awaited thing never completes.

**What is eating memory.** `dumpheap -stat` and read the bottom of the list: the largest total size,
then the largest count. Take the suspicious type, `dumpheap -type <Name>` for an address, then
`gcroot <address>`. The root path is the answer — a static field, an event handler, a cache, a
captured context. `objsize` tells you how much that one object really retains, which is often the
difference between "a hundred small objects" and "a hundred objects holding the whole result set".

**What threw.** `clrthreads` shows threads with a pending exception; `setthread` to it and `pe`. Read
the inner exception chain to the bottom — the outermost message is almost always the least useful one.

## Symbols

Managed stacks need the assemblies' symbol files to show line numbers. Without them you still get
type and method names, which is usually enough. Fetch missing runtime symbols with `dotnet-symbol`
against the dump, and keep your own build's symbol files as pipeline artefacts — a release built
months ago cannot be re-created byte-identically, so if the symbols were not kept, line numbers are
gone for good.

## Alternatives that are sometimes faster

| Instead of a dump | When |
|---|---|
| `dotnet-stack report` | you only need the stacks and the process may keep running |
| `dotnet-gcdump` | it is a memory question; far smaller, and safe on a live process |
| The IDE's dump debugger | you want to browse objects and locals visually |
| A native debugger with the SOS extension | native frames, or a corrupted-runtime scenario |

Prefer the gcdump for memory: it captures the object graph without the full memory image, so it is a
few megabytes instead of gigabytes, and diffing two of them beats reading one dump.

## Handling

- A dump contains connection strings, tokens, session data and customer records in clear bytes. It is
  a secret. Store it where secrets are stored, never in the repository, never attached to a work item
  or a pull request, and delete it when the investigation ends.
- Record the pid, the timestamp, the build identifier and the load conditions next to the file.
- Extract the findings before deleting: the grouped stacks, the heap statistics, the retention path.
  Re-opening a dump to re-read something you already saw costs another twenty minutes.
