BEGIN;

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.rev_voc_is_ordinary_question(jsonb,jsonb)'::regprocedure
  ) INTO definition;

  IF definition LIKE '%convict|conviction|sentenc%' THEN
    RETURN;
  END IF;

  IF definition NOT LIKE '%conviction|sentenc%' THEN
    RAISE EXCEPTION 'Expected security filter not found';
  END IF;

  definition := replace(
    definition,
    'conviction|sentenc',
    'convict|conviction|sentenc'
  );

  EXECUTE definition;
END;
$$;

COMMIT;
