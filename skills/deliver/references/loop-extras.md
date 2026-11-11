# Loop extras — who reads what, the cleanup pass, the scope check, `/retro`

Read when the owner asked a cleanup pass, the gate said `red: scope`, a run is relaunched, or you need to know who
reads what.

## Who reads what (M, L)

- **Reader A, per block**: Sonnet at high reads each block's delta as soon as its gate is green. An open P1/P2 inside
  the perimeter gets one fix call and one gate run; what is still open is carried to the final verification and
  counted in `blocks[].readerA`. The brief names the gate's `formatOnly` files once: no formatting findings on them.
- **Final verification**: once, after the last block, the readers `finalReadersFor` picks read the whole diff together
  with the carried findings: reader B (Sonnet at high; Opus at high at L, with a security or data axis, past 10 files
  or 600 lines unless mechanical, or with 3+ axes besides `logic`), at L a second Sonnet reader at high, and the
  specialists the risk names.- **Verifier**: after each fix round and its gate, one `code-reviewer` marks each finding closed or open and reads the
  fix delta for new defects: Sonnet at high; Opus at medium with a P1 or a fix over 30 lines.
- **Arbiter**: a finding the implementer rejects and its raiser keeps goes once to Opus at medium; its ruling stands.

A `scope` finding raised by one reader alone and not CONFIRMED (M, L), in a round another reader also answered, blocks nothing and is never fixed: it stays in `minor`.

## The cleanup pass before OK (M, L)

Runs only with `cleanup: true` (the owner asks for it); by default the P3s stay in `minor` for the closing table. A round that would end `OK` with P3 findings inside the perimeter (not a `scope` hunk, not a `clean-code` split proposal, not one the
change does not cause in a file it did not touch) first runs one fix pass on them, then one verifier on that delta (a cleanup id closes only on its explicit `closed` verdict, silence never closes one); a second cleanup never runs. The result lists what the pass fixed under `cleaned` once the delta
review has read it; `minor` keeps the rest, and `outOfScope` the P3s outside the perimeter: all for the closing table.

## Scope check, `red: scope`

The gate's `outside` files are outside the perimeter. To revert them: back to step 3 with them as the brief, relaunched as in "A red test after OK" (`references/stall.md`). To keep one the user wants: `perimeter.ps1 -Files` with all entries, then a NEW run with the updated `perimeter.files` (no resolution: there is no stalled round).

## `/retro`

When the owner settles a `/retro`, append `{"retro":"<date>"}` to `findings.jsonl` (`references/loop.md`, the findings log).
