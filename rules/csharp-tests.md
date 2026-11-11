---
paths: "**/*Tests*/**/*.cs,**/*.Tests.csproj"
---
# C# tests — house facts

- Every test you add or rewrite is Given/When/Then: named `Given_<State>_When_<Action>_Then_<Outcome>`,
  its body split by `// Given`, `// When`, `// Then`, each opening its block. It's the house convention and
  wins over the siblings' naming; don't rename a test you don't otherwise touch.
- For the rest copy the nearest sibling test: framework, assertion library, fixture shape.
- One reason to fail per test; the name says which.
- No wall clock, randomness, network or shared mutable state: inject the clock, the seed, a fake.
- An RPC responder or subscriber is tested through its handler method — that is the seam.
- Queries and raw SQL run against a real engine (a container), never the EF in-memory provider.
- A bug fix starts with a test that fails for the reported reason, then passes.
- A hand-written fake beats a mock once the setup outgrows the assertion.

Procedure: skill `dotnet-testing`.
