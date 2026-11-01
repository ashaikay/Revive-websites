# REV Business Hub: v0 prototype brief

Status: prepared for v0; prototype not generated, reviewed or approved. Source: user-provided Notion decision dated 27 October 2026. No application, database or production changes accompany this brief.

## Paste into v0

Design an interactive executive dashboard and navigation prototype for REV Business Hub, an existing business application supporting employment programmes, employer engagement, workforce scheduling and Outlook-assisted work. Use fictional demo data only. Show a persistent, understated “Design preview · Demo data” label.

Deliver reusable React 18 / TypeScript presentational components compatible with Vite and Tailwind CSS 3. Prefer native elements and minimal dependencies. Do not require Next.js routing, server components, API routes, server actions, authentication, Supabase, databases, secrets, analytics, or external AI providers. Do not import the private repository yet: it has local navigation work that must be reviewed separately.

Start with one cohesive dashboard and application shell. Use a restrained, premium business style: warm off-white canvas, white surfaces, charcoal typography, emerald primary actions, quiet borders, generous spacing and a clear typographic hierarchy. No decorative gradients or oversized empty hero. Use an 8px spacing rhythm, modest 12px corners, readable body text and tabular figures. Define semantic CSS tokens for colours, typography, spacing, radii, focus and status. Maintain WCAG AA contrast, visible keyboard focus, clear labels and 44px touch targets. Status must not rely on colour alone. Respect reduced motion.

Desktop: persistent left navigation, workspace/account header and spacious main canvas. Mobile: compact header and accessible menu drawer with Escape, focus management and focus return; single-column cards and compact activity rows. Demonstrate 1440px desktop and 390px mobile, with no page overflow at 320px or 200% zoom.

Navigation examples: Overview, REV, Outcomes, Scheduling and Growth. Use stable IDs home, rev, programme, scheduling, growth. Accept navigation items as props and hide unavailable items; show a separately labelled demo switch between owner and Employment Specialist views to demonstrate presentation only. Never treat that switch as actual authorisation. Customers/business are existing optional route slots, not new feature builds.

Dashboard content: “Today at a glance”; four clearly defined example counts such as active Service users, employers to follow up, shifts needing attention, and items awaiting review; an actionable “Needs your attention” list with programme/ES/next-action context; today’s schedule; and recent activity with author and timestamp. Use fictional names and internally consistent counts. Do not invent job-readiness, employment outcomes, live monitoring health, money earned, or tasks completed by REV. Include zero, loading, unavailable and error variants; unavailable is different from zero. An Outlook item must say “Draft awaiting review”, never “Sent” without a real confirmed result.

Show the signed-in demo user name and role clearly. Distinguish assignment from authorship. In the ES view, show a visible “Open vocational profile” action on an assigned Service-user example; questionnaire building is a manager action. Keep sensitive support permissions separate from ordinary vocational completion.

Build only dashboard/navigation now. Do not implement full programme, employer, matching, scheduling or email workflows. Example links may show a clear prototype-only destination panel; sample review actions must visibly say “Demo action — nothing sent or saved”. Avoid dead buttons, fake live search, fake notifications, or claims of persistence.

Deliver component source, demo fixtures separate from UI, semantic tokens, desktop/mobile previews and a short component/state inventory. Present the design for review before extending any other screen.

## Integration map (after design approval)

| Prototype boundary | Existing REV code | Integration requirement |
| --- | --- | --- |
| App shell / main layout | `revive-app/src/App.tsx` | Preserve provider selection, session lifecycle, workspace reset and component keys. |
| Navigation / account and workspace controls | `revive-app/src/components/Navigation.tsx` | Preserve `allowedPages`, hash IDs, workspace selection and sign-out callback. Review Windows Navigation.tsx and rev-premium-navigation.css first. |
| Executive dashboard cards | `revive-app/src/components/HomeDashboard.tsx` | Render existing owner-control-centre model; current live unavailable state must stay truthful. Demo KPIs are not a new live data contract. |
| Access boundary | `revive-app/src/components/WorkspaceModuleGate.tsx` | Keep permission checks outside visual components; no frontend role-switch grants. |
| Programme record / vocational entry | `revive-app/src/components/ProgrammeHubModule.tsx` and `ParticipantVocationalAssessment.tsx` | Later integration: preserve selected scope, save retries, author attribution and assessment snapshots. |
| Scheduling / Outlook | `SchedulingModule.tsx`, `OutlookConnectionPanel.tsx`, `REVInterface.tsx` | Later visual-only increments. Preserve confirmations, uncertainty states and provider gates. |
| Shared footer / tokens | `AppFooter.tsx`, existing CSS and Tailwind configuration | Scope tokens initially to avoid restyling unreviewed workflows. |

## Review and incremental delivery

1. Obtain v0 export and desktop/mobile screenshots. Verify local Windows navigation changes are backed up, reviewed and explicitly included or retained separately before relying on a GitHub import. Do not add backup archives, environment files or unrelated local material to Git.
2. Review navigation, readable density, signed-in identity, truthful states and mobile behaviour with the user. Record decisions; approval is not yet established.
3. Create a separate design integration branch from the verified merged production commit, not stale main or the prior release branch. Compare remote production SHA before work. Keep prototype fixtures separate from production imports.
4. Integrate tokens and navigation first, then dashboard, using the existing module gates and live data contracts. No migrations or new auth needed for this step.
5. Run build and relevant auth/module-gate, navigation, workspace-switching and owner-control-centre regressions. Verify manager/ES access and keyboard/mobile behaviour on a preview. For any later change touching reads or permissions, also run relevant RLS and workflow checks.
6. Merge an increment only after its checks and visual review pass. Do not expand frozen MVP scope.

## Evidence and limitations

Repository inspected locally on 30 October 2026: React 18, Vite 6, TypeScript, Tailwind 3 and Supabase. Existing navigation supports home/rev/customers/programme/scheduling/growth/business IDs and filters allowed pages. HomeDashboard deliberately uses an unavailable owner-control-centre model in live provider mode; the prototype must not erase that distinction.

No v0 connector is available in this session. No v0 prototype has been created or approved. User confirmed the prior release was merged and published and Robert's assigned vocational workflow passed. Remote release SHA has not been independently checked here. Local Windows premium navigation files are not present in this checkout. No current REV monitoring configuration has been verified; no healthy or zero-error claim is justified.
