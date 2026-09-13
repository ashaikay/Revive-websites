# Revive Websites / Revive AI — Copilot Repository Instructions

## Project purpose

This repository contains the existing Revive Websites marketing website and the new Revive AI product/application being developed alongside it.

The existing Revive marketing website is production-sensitive and must remain protected.

The current development stage must be determined from REVIVE_AI_MASTER.

Do not rely on a hardcoded phase number in this file.

At the start of any substantial task, consult the current project-control documentation in REVIVE_AI_MASTER to identify the active phase, completed checkpoints, and next authorised work.

The Phase 0 protection/baseline work has already been completed.

The master project-control documentation is located in:

REVIVE_AI_MASTER

Always consult the relevant files in REVIVE_AI_MASTER before making significant architectural changes.

## Critical protection rules

1. DO NOT redesign, restructure, refactor, replace, or materially alter the existing Revive marketing website unless the user explicitly asks for that exact change.
2. The existing marketing website and the new Revive AI application must remain logically isolated.
3. Do not move existing production files simply to make the repository structure cleaner.
4. Do not perform broad repo-wide refactors without explicit instruction.
5. Do not rename folders, routes, database resources, environment variables, APIs, Supabase resources, or existing production services unless explicitly authorised.
6. Do not delete code merely because it appears unused without first proving that it is not referenced elsewhere.
7. Preserve backward compatibility unless the requested task specifically requires a breaking change.
8. Never expose secrets, service-role keys, API keys, tokens, passwords, private environment variables, or credentials in frontend code, logs, commits, documentation, or responses.
9. Never commit .env files or production secrets.
10. Treat database migrations and production integrations as high-risk changes.

## Working method

For each task:

1. Read the user's task carefully.
2. Inspect only the files needed to understand the requested change.
3. Check REVIVE_AI_MASTER when the task affects architecture, scope, database design, product boundaries, or major workflows.
4. Identify the smallest set of files that must change.
5. Prefer targeted edits over broad refactoring.
6. Preserve existing working functionality.
7. Implement the requested change.
8. Run the most relevant validation/build/test commands available.
9. Fix errors caused by the change.
10. Report clearly:
   - what changed;
   - which files changed;
   - tests/builds run;
   - any remaining warnings or risks.

Do not spend large amounts of time exploring unrelated parts of the repository.

## Agent efficiency

Minimise unnecessary agent activity and token usage.

Do not repeatedly scan the entire repository when a targeted search is sufficient.
Do not reread large files unnecessarily.
Do not run unrelated tests.
Do not make speculative improvements outside the current task.
Do not create additional features because they seem useful.
If the requested task is small, keep the implementation small.
For complex tasks, first understand the affected architecture before editing.

## Change control

Before making a high-risk change, identify the affected systems.

High-risk areas include:

- authentication;
- Supabase configuration;
- database schema;
- RLS policies;
- Edge Functions;
- billing;
- Stripe;
- subscriptions;
- webhooks;
- permissions;
- user data;
- production environment variables;
- deployment configuration;
- shared application architecture.

For high-risk work:

- inspect existing implementation first;
- preserve production-compatible behaviour;
- avoid destructive database operations;
- avoid irreversible migrations;
- make migrations explicit and reviewable;
- do not silently change security policies.

## Supabase rules

This repository already has its own Supabase project/database.

Do not create or connect another Supabase project unless explicitly requested.

Before changing database behaviour:

- inspect the existing schema;
- inspect relevant migrations;
- inspect RLS policies;
- identify frontend/backend dependencies.

Use migrations for schema changes rather than undocumented manual database changes whenever practical.

Never place a Supabase service-role key in browser/frontend code.

Do not weaken RLS simply to make a feature work.

## Code quality

Follow the existing project's language, framework, component, naming, formatting, and directory conventions.

Prefer existing utilities and components over unnecessary duplication.

Keep functions focused.
Avoid unnecessary dependencies.
Do not replace a working dependency simply because another library is preferred.
Avoid placeholder implementations when production behaviour is expected.
Handle failures explicitly where appropriate.
Maintain user-facing loading and error states.

## UI changes

When changing the UI:

- preserve the established Revive branding unless specifically asked to change it;
- do not redesign unrelated screens;
- maintain responsive behaviour;
- avoid changes that break desktop or mobile layouts;
- reuse existing styles/components where practical.

For a requested UI fix, change only what is necessary to satisfy the request.

## Testing and validation

After code changes, use the project's existing commands where available.

Typical validation may include:

- build;
- type checking;
- linting;
- focused tests;
- relevant integration checks.

Do not claim a test passed unless it was actually run.

If something cannot be tested locally, state that explicitly.

Do not hide existing errors by disabling validation.

## Git safety

Do not run destructive Git commands unless explicitly authorised.

Do not:

- force push;
- reset --hard;
- delete branches;
- rewrite shared history;
- remove unrelated uncommitted work.

Before committing, inspect the diff and ensure unrelated files have not been changed.

Keep commits focused on the requested task.

## Decision hierarchy

When instructions conflict, use this priority:

1. The user's current explicit instruction.
2. Safety/security/data-protection requirements.
3. REVIVE_AI_MASTER project-control documentation.
4. These repository instructions.
5. Existing project conventions.

If a proposed change would violate a higher-priority rule, stop and explain the conflict rather than silently overriding it.

## Core principle

Revive AI should be developed incrementally without destabilising the existing Revive Websites product.

Protect existing functionality first.

Make the smallest reliable change that achieves the requested outcome.
