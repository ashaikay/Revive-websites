BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE public.programme_hub_vocational_restricted_answers
FROM anon, authenticated;

COMMIT;
