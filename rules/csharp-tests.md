---
paths: "**/*Tests*/**/*.cs,**/*.Tests.csproj"
---
# C# tests — house facts

- Copy the nearest sibling test's style: framework, assertion library, fixture shape, naming
  (`Method_State_Expected` where the repo uses it). Never introduce a second convention.
- One reason to fail per test; the name says which.
- No wall clock, randomness, network or shared mutable state: inject the clock, the seed, a fake.
- An RPC responder or subscriber is tested through its handler method — that is the seam.
- Queries and raw SQL run against a real engine (a container), never the EF in-memory provider.
- A bug fix starts with a test that fails for the reported reason, then passes.
- A hand-written fake beats a mock once the setup outgrows the assertion.

Procedure: skill `dotnet-testing`.
