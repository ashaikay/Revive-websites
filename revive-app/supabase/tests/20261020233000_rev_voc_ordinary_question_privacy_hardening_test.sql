-- Run manually against LOCAL Supabase after applying migration. Read-only assertions.
DO $test$
DECLARE
  ordinary jsonb := '{"id":"q1","label":"What type of work would you like?","sensitive":false}'::jsonb;
  sensitive jsonb := '{"id":"q2","label":"What type of work would you like?","sensitive":true}'::jsonb;
BEGIN
  IF NOT public.rev_voc_is_ordinary_question('{"title":"Employment goals"}'::jsonb, ordinary) THEN
    RAISE EXCEPTION 'FAIL ordinary employment question rejected'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Criminal Justice and Resettlement Support"}'::jsonb, ordinary) THEN
    RAISE EXCEPTION 'FAIL criminal justice section allowed'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Employment goals","description":"Probation support"}'::jsonb, ordinary) THEN
    RAISE EXCEPTION 'FAIL sensitive section description allowed'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Employment goals"}'::jsonb, '{"label":"Have you been convicted?","sensitive":false}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL sensitive question label allowed'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Employment goals"}'::jsonb, '{"label":"Work preferences","description":"Prison release date","sensitive":false}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL sensitive question description allowed'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Employment goals"}'::jsonb, sensitive) THEN
    RAISE EXCEPTION 'FAIL sensitive flag allowed'; END IF;
  IF public.rev_voc_is_ordinary_question('{"title":"Employment goals"}'::jsonb, '{"label":"Work preferences"}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL missing sensitive flag allowed'; END IF;
  RAISE NOTICE 'PASS Stage 3B5 ordinary/restricted question boundary';
END;
$test$;
