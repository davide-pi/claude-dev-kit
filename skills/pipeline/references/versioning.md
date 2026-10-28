# Semantic versioning driven by a config file

Each tree carries a version config file at its root. The version is **computed**, not typed: the
tool reads the git history, the branch name and the tags, applies the rules in that file, and hands
the result to the pipeline as variables. Nobody edits a version number by hand.

## Which mechanism this tree uses

Check before changing anything:

| Evidence at the tree root or in the project files                | Mechanism                                  |
| ---------------------------------------------------------------- | ------------------------------------------ |
| A version config file at the tree root, and a version step in CI  | computed from git history — this file      |
| A `Version`/`VersionPrefix` property in a shared props file        | declared in the repository, bumped by hand |
| Neither                                                            | the build number is the only version there is |

Never introduce the second alongside the first: file version and package version would disagree.

## What the config file decides

| Rule in the file            | Effect                                                                 |
| --------------------------- | ---------------------------------------------------------------------- |
| the next-version floor      | the version the tool starts from when there is no tag to count from    |
| per-branch behaviour        | which branch produces a release version and which a pre-release label  |
| the increment per branch    | whether a commit on that branch bumps patch, minor, or nothing         |
| tag handling                | which tags count as releases, and the tag prefix                       |
| commit-message directives   | the token that forces a major or minor bump from a commit message      |

## What the pipeline gets

The version step sets pipeline variables (full semver, major/minor/patch, pre-release label, short
sha). Read the names from the version step's own log on a recent successful run; they differ between
the tool's modes.

```yaml
steps:
  - checkout: self
    fetchDepth: 0                # MANDATORY: the tool counts commits and needs the whole history
    fetchTags: true              # and the tags, which a shallow clone does not bring

  - task: <version task>@<major>
    displayName: Compute version
    name: version                # so later steps can reference its output variables

  - script: dotnet build -c Release -p:Version=$(version.<full-semver-variable>)
    displayName: Build with the computed version
```

Set the run's name so the version is visible in the runs list: `name: $(version.<full-semver-variable>)`
(preferable when known at queue time), or update the build number from inside the job with the logging
command.

## Carrying the version outward

| Output               | How the version reaches it                                                |
| -------------------- | ------------------------------------------------------------------------- |
| .NET assemblies      | `-p:Version=` on build, which sets assembly, file and informational version |
| NuGet package        | `-p:PackageVersion=` on pack, or `Version` when they should match          |
| Pipeline artifact    | in the artifact name, or in a file inside it — never only in the run name  |
| Container image      | as the image tag, alongside a moving tag if one is wanted                  |
| Front-end bundle     | injected into the build's environment, so the app can display it           |
| A git tag            | created only on a release branch, and only after the deploy succeeded      |

A deployed build should expose its informational version (one endpoint or one startup log line).

## Why the version drifted

| Symptom                                              | Cause                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| The version resets to the floor on every run          | shallow clone — no history to count, so nothing to count from |
| A pre-release label appears on the release branch      | branch rules in the config file do not match the branch name  |
| The version does not move across several commits       | the branch's increment rule is "none"; only a tag or a directive moves it |
| It jumped by more than one                             | a commit-message directive, or a tag pushed by hand           |
| It differs between two jobs in the same run            | the version step ran twice; run it once and pass the value on |
| It differs from the git tag                            | the tag was created before the run, or on a different commit  |
| A pull-request build's version looks wrong             | a PR build is a merge commit on a detached head; expected, and why PR builds do not publish |

The first row is the most common and silent: nothing fails, the number is just wrong. Any change to
how the repository is checked out has to be checked against the version output.

## Branch strategy and the version, together

The branch conventions in `branch-flow` and the version config file have to agree. When a prefix
changes (a new `hotfix/` shape, a renamed default branch) the config file is part of that change. A
branch with no rule falls through to the fallback: a pre-release label nobody expected.

## Bumping deliberately

| Intent                                    | Action                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| Breaking change                            | the config file's major directive in the commit message, or a tag |
| New feature                                | rely on the branch increment rule; do not hand-edit            |
| A release from the current commit           | tag the commit, then let the pipeline read the tag             |
| Restart numbering for a new product line    | raise the floor in the config file, in its own commit          |

If a version has to be forced by editing a pipeline variable at queue time, the config file is wrong:
fix the file.
