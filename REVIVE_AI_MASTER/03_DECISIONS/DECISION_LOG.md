# Decision Log

## 2026-08-25 — Protect the live Revive Websites site as a separate public marketing surface
- Decision: keep the existing marketing website untouched and isolated as a production public asset.
- Alternatives considered: rewrite it into the app, inline the app into the same domain, or repurpose it all at once.
- Chosen option: separate the active site from the future Revive AI app with a clear boundary and a new app workspace.
- Reason: minimizes risk to the live site and follows the project requirement to protect the existing website.
- Consequences: the public site remains stable while the customer platform is designed in controlled phases.

## 2026-08-25 — Use master-control documentation as the source of truth
- Decision: all project status, roadmap, logs, and phase tracking will live in REVIVE_AI_MASTER.
- Alternatives considered: rely on ad hoc notes or conversational memory.
- Chosen option: centralize permanent project state in the master-control directory.
- Reason: required for continuity and handover safety.
- Consequences: future sessions can resume from a single source of truth.

## 2026-08-25 — Do not begin application implementation before Phase 1 architecture
- Decision: no AI Business Hub feature development will start until the architecture specification is complete.
- Alternatives considered: begin building app shell immediately.
- Chosen option: finish baseline and architecture planning first.
- Reason: this preserves security, reduces rework, and prevents early architecture mistakes.
- Consequences: the app will be built in a more controlled and lower-risk sequence.
