---
paths: "**/README*,**/docs/**/*.md,**/CONTRIBUTING*,**/CHANGELOG*,**/adr/**/*.md"
---
# Documents — plain technical writing

For a document people read: README, docs, ADR, spec, guide. The rules follow ASD-STE100
(Simplified Technical English) and hold in every document language. No document claims STE.

- A sentence has at most 20 words in a procedure and 25 in a description.
- A paragraph has one topic and at most six sentences.
- A step gives one instruction, in the imperative. Other information goes in a note.
- Use the active voice. Use the passive only when the actor is unknown.
- Use simple tenses.
- A noun group has at most three words. Break a longer one with a preposition.
- Use one term for one thing in the whole document. Repeat the term, never a synonym.
- Put an article or a demonstrative before a noun where the language allows it.
- No jargon, no slang, no semicolon. Use a vertical list when a sentence gets complex.
- A safety instruction gives the risk level first, then the command or condition, then the result.
- Italian: write the verb, not its noun (`verificare`, not `effettuare la verifica`). No passive
  with `venire`, no chain of subordinate clauses, no gerund that joins two actions.
- A domain term from the glossary is never simplified, replaced or translated.
- The repository's `CONTRIBUTING.md` wins where it says otherwise.
- Kit assets keep their compact form: rule `kit-assets`.
