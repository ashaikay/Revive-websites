# Employer discovery and outreach preview origins

Both functions used the calendar's single-origin setting and returned localhost as allow-origin when the preview origin was denied. They now use the existing Programme Hub origin configuration helper, preserving primary and additional exact origins. Boundaries accept comma-separated exact matches and omit allow-origin on denial. No wildcard origins or authentication changes.

Validation: 30 Node boundary tests pass across discovery, outreach and Programme Hub save. New tests cover preview, production, localhost and lookalike-origin denials without calling authentication during preflight. Hosted deployment and preflight verification remain pending. Deploy both employer functions; no migration or secret change is required when the previously configured Programme Hub additional preview origin remains present.

Separate incident: the user reports two 503 responses from programme-hub-save after an unassignment. This status may be an unclassified database error, transport/Edge failure or unexpected acknowledgement. No cause or committed outcome is established from console status alone. Preserve the exact retained request and inspect the function's invocation/body and safe structured `programme_hub_save_rpc_rejected` log (operation, postgresCode and errorCode); do not clear or manufacture a replacement write.
