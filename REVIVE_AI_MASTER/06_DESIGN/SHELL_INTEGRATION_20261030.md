# Business Hub shell: first visual integration

Status: implemented on `design/rev-business-hub-shell-20261030`; not approved or deployed. Based on verified remote production merge `e2bc6de` (PR #4), preserving the user's Windows Navigation.tsx behaviour and supplied stylesheet's transition/focus/reduced-motion intent. Scoped green/off-white styling follows the v0 reference; no Next.js, React upgrade, analytics, fake data or new package dependencies.

Changes: desktop sidebar, mobile native modal drawer, account name/email and real sign-out, existing workspace selector, active gated destination, existing hash routes and allowed-page filtering. Existing optional Customers/Business destinations remain available only when permitted, rather than being silently removed for a prototype's five-item menu. Live account identity is passed from liveSession; no demo manager title is invented. Shell styles are scoped; module bodies, data, scheduling calendar/timestamps, forms, retries, RPCs and role gates are unchanged. This increment does not yet restyle dashboard cards or other module interiors.

The native mobile dialog makes background controls inert, focuses Close, supports Escape and returns focus to the opener. Navigation, workspace changes, auth-user changes and desktop resizing close the drawer; unmount releases the body scroll lock. Skip to content focuses the existing content without changing the application hash. No account-menu icon or decorative nonfunctional controls remain.

Validation: 103 tests in six files pass (navigation, invitation/session application, module access, owner control centre, Programme Hub, scheduling month planner). Default and Supabase-mode builds pass; existing chunk-size warning remains. Chromium checked mock-mode desktop/mobile at 1440/390 widths, Escape/focus return and no horizontal page overflow at 320,390,768,1440; zero page errors. Screenshots are local review artifacts under `/workspace/artifacts/rev-shell/`, not production evidence. Hosted authenticated preview review and keyboard testing on the user's own browser remain pending. No RLS changes warrant new RLS migrations; existing module-access and Programme Hub tests passed.

Review desktop/mobile shell first. Then adapt dashboard cards and module layouts in further small increments using actual working components. Keep production unchanged until review and checks pass. The user's Windows navigation files remain locally modified; do not merge over them without first preserving them, and never add their unrelated backups or archives.

## CI correction — 1 November 2026

The initial design PR failed the Programme Hub contract test: it compared exact uppercase navigation object literals with the old inline href shape. Reproduced locally: one failed, 882 passed. The actual stable destinations remained intact, but the first targeted check omitted this contract file.

Navigation definitions now live in `domain/workspaceNavigation.ts`, retaining the existing IDs and hashes. The contract checks those stable route mappings rather than presentation-specific source text. Seven mounted navigation tests additionally click each destination and verify its actual hash. Existing filtering, gated active state and workspace/auth lifecycle tests remain.

Validation after correction: full `npm run test:all` passed all 890 Vitest tests in 107 files plus 550 Node boundary tests. Both default and Supabase-mode production builds passed. No workflow skips, permission changes or assertion timeouts were introduced. Hosted checks must rerun on the corrected commit before merge.

## Dashboard increment - 1 November 2026

Adapted the supplied v0 export's off-white canvas, white bordered surfaces, 12px corners, emerald approval action and compact summary cards in the existing HomeDashboard. All eight owner-control-centre sections, read models, routes and execution caveats remain. Four read-only summaries count existing work, approvals, dry-run-ready items and results, not prototype service users, shifts or activity. Live operational summaries explicitly say Unavailable rather than zero; mock mode is labelled Demo workspace data. No data contract, dependency, backend or permission changes.

The Windows navigation import, stylesheet and existing encoding damage were inspected and left unchanged in the original worktree. Integration uses an isolated worktree on the design branch at verified PR head afe9ba7. The ZIP was located in Downloads and extracted only to session storage; no fixtures or Next.js scaffolding were imported into production.

Validation: 36 tests across owner-control-centre model/UI, navigation and workspace invitation/session files passed. Default production build passed with the existing chunk-size advisory. Local mock-mode Chromium checks found no page overflow at 320, 390, 768 and 1440px; summary cards reflow from four to two to one columns. PR #5 at afe9ba7 had 24 successful checks, three neutral Netlify checks and a successful deploy-preview status. Authenticated hosted visual review remains pending. This increment is not merge or production-deployment approval.
