# The deploy side — Ansible playbooks pulling build artifacts onto Linux hosts

For the large backend, Azure DevOps **builds and publishes**; a separate deploy repository of Ansible
playbooks **deploys**. Read the playbooks there before assuming a release stage does the work. This
file describes the shape; host names, ports, build-definition ids and every secret stay in that
repository (inventory, `group_vars`, an Ansible vault) and are never copied into a pipeline or a note.

## What a deploy does

| Step | Mechanism | Consequence for the pipeline |
| --- | --- | --- |
| resolve the build | REST call for the **last succeeded** run of a build definition id (`build_def_id` per service); `-e build_id=<id>` overrides it | the build must publish on every successful run of the branch that deploys; a "succeeded" run with a missing artifact breaks the next deploy |
| fetch the artifact | one named pipeline artifact (a zip of per-service zips) downloaded once per build id to a staging folder on the control node | artifact **name** and inner zip names are a contract with `group_vars` — renaming either in YAML breaks the deploy silently |
| install a release | unzip into `/opt/services/<service>/releases/<build-id>` | each build is a separate release folder |
| configure | merge per-service keys from `group_vars` into `appsettings.json`, and log levels into `serilog.json` | configuration does not come from the pipeline: never bake environment values into the artifact |
| activate | systemd unit from a template, `current` symlink switched to the new release, restart, `systemctl is-active` retried | tasks tagged `activate`; `--skip-tags activate` stages a release without switching |
| prune | keep the newest three releases | rollback = point `current` at a kept release and restart |

The unit runs the published binary directly with `ASPNETCORE_ENVIRONMENT=Production` and the HTTP
port from `group_vars` — so the build must publish a **runnable** framework-dependent or
self-contained output for Linux, with the binary name the `group_vars` entry expects.

## Playbooks, by intent

| Intent | Playbook | Shape |
| --- | --- | --- |
| deploy every service of one host group | `deploy.yml -e target=<group>` | `serial: 1` — one host at a time |
| deploy one service | `deploy.yml -e target=<group> -e deploy_service=<name>` | |
| deploy everything built by one build definition | a `block-*.yml` | imports `deploy-db.yml` for its database **first**, then `deploy.yml` with that definition id |
| apply a database migration | `deploy-db.yml -e db=<key>` | runs on the SQL host group |
| check | `health-check.yml -e target=<group>` | `GET /health` on each service's port, OK/FAILED per service |
| status, restart, stop | `service-status.yml`, `restart-service.yml`, `stop-service.yml` | systemd verbs |
| remove the pre-releases layout | `cleanup-old.yml` | **always** `--check --diff` first |

## The database step

`deploy-db.yml` fetches the same build's artifact, copies a `db-migration.zip` to the SQL host, unzips
it and runs the contained `migration.sql` with `sqlcmd -b` against the database mapped for that key.
Therefore:

- The build must produce `migration.sql` with `dotnet ef migrations script --idempotent` — the
  procedure in the `ef-core` migrations reference. A non-idempotent script fails on its second run.
- `-b` makes the first SQL error fail the play, and the services of that block are not deployed.
  A failed migration is fixed forward with a new migration, never by editing the applied one.
- The migration runs **before** the new services start, so it must stay compatible with the old
  service version still running: expand first, contract in a later release.

## Running a playbook

```powershell
# From the deploy repository, on the control node — never from a build agent by improvisation
ansible-playbook -i inventory/<inventory> deploy.yml -e target=<group> -e deploy_service=<name> --check --diff
ansible-playbook -i inventory/<inventory> health-check.yml -e target=<group>
```

A production deploy is an operator action with an explicit go: propose the exact command, never run
it on your own, and run `--check --diff` first whenever the playbook allows it.
