# review-security — rare branches

Rare branches of `review-security`: the skip list for generated files, and effort above `medium`.

## Input (files to skip)

Skip the generated files `SKILL.md` § Do excludes.

## Effort

| Effort | Steps |
| --- | --- |
| `high` | + sibling handlers for the expected guard; taint one hop beyond the diff |
| `xhigh` | + a short threat model per entry point (who, gain, what stops them); trust assumptions of each new dependency |
| `max` | + falsify every candidate by finding the guard that would stop it |
