# Database release policy

Application startup checks the existing SQLite schema and user_version; it never initializes tables or runs migrations. An absent or incompatible database prevents startup. Operational writes (sessions, project edits, interrupted video task recovery) remain normal application behavior.

Fresh installation: stop the app, set DATA_DIR, run `npm run db:init`, then initialize the admin explicitly. The init command refuses an existing database.

Database changes require a manual release, even when CI passes. Add versioned migration logic to scripts/database.mjs and the schema contract to server/schema.mjs. Keep all schema/data migration code in these files (or migrations/). Do not hide migrations in application startup or dependency lifecycle scripts. Test an existing database fixture and preservation of users, projects and media references.

Manual release: stop the app and confirm workers have exited; create a consistent backup; inspect and execute `npm run db:migrate` using the intended DATA_DIR as the service user; run `npm run db:check`; deploy/start the reviewed version and verify health. Update the server's deployed-sha marker only after acceptance. Unknown or incompatible schema requires an explicit migration; the CLI never repairs tables automatically. The initial migration adopts a structurally compatible legacy version-0 database and converts the retired fashion category to fmcg transactionally.

CI checks changes in database-sensitive paths and schema SQL. The root-owned ECS deployment entry independently compares against the last successfully deployed commit, so a later ordinary commit cannot carry an unapplied migration through automatically. workflow_dispatch does not bypass this restriction. Static detection is a guardrail, not a semantic proof: reviewers must classify any data migration as a manual database release.

For routine releases, run db:check against the live database read-only before restart. Never invoke db:init or db:migrate in automatic deployment. Tests explicitly initialize disposable databases; CI never connects to the live database.
