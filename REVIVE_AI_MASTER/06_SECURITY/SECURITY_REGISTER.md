# Security Register

## Sensitive items identified
- Supabase project URL exists in client config.
- Supabase anon key exists in client config.
- Netlify static deployment guidance exists in project docs.
- Calendly booking link exists in public pages.

## Security handling notes
- Do not write secret values into project documentation.
- Keep server-side configuration outside browser-visible code.
- Never trust frontend-supplied user IDs, credit balances, or subscription state.
- Never execute user-generated code on the primary production server.
- Keep tenant data isolated by workspace/business boundaries.

## Known risks
- Browser-exposed config is easier to read and should not be used for privileged operations.
- AI-generated website code must be sandboxed and never executed in the host production environment.
- Billing and credit validation must be enforced server-side.

## Current security status
- Baseline review complete.
- No production deployment or payment flow has been activated.
- No direct customer-data processing is active.
