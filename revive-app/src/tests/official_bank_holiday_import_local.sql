-- Run on the local database after the import migration, inside a rolled-back transaction.
begin;
do $$
declare
 actor uuid=gen_random_uuid();
 member uuid=gen_random_uuid();
 workspace uuid=gen_random_uuid();
 other_workspace uuid=gen_random_uuid();
 worker uuid;
 calendar uuid;
 other_calendar uuid;
 review jsonb;
 imported jsonb;
 retried jsonb;
 request uuid=gen_random_uuid();
 events jsonb='[{"date":"2026-01-01","title":"New Year"},{"date":"2026-12-25","title":"Christmas"}]';
 old_revision bigint;
 before_count bigint;
 account_snapshot jsonb;
 posting_snapshot jsonb;
begin
 insert into auth.users(id,email) values(actor,'official-import-owner-'||actor::text||'@example.test');
 insert into auth.users(id,email) values(member,'official-import-local-'||member::text||'@example.test');
 insert into public.workspaces(id,name,slug,created_by) values(workspace,'Official import local','official-import-'||workspace::text,actor),(other_workspace,'Official import other','official-import-'||other_workspace::text,actor);
 insert into public.workspace_members(workspace_id,user_id,role,status) values(workspace,actor,'owner','active'),(workspace,member,'member','active'),(other_workspace,actor,'owner','active');
 worker=(public.save_rev_scheduling_worker(workspace,actor,gen_random_uuid(),null,'Import worker','{}','{}',true,0)->>'worker_id')::uuid;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into account_snapshot from public.annual_leave_accounts a;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into posting_snapshot from public.annual_leave_postings p;
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,null,'england-and-wales',2026,events,now(),null,null);
 if review->>'action'<>'preview' or (review->>'additions')::integer<>2 or (review->>'calendarId') is not null then raise exception 'Preview shape failed';end if;
 if exists(select 1 from public.annual_leave_calendars where workspace_id=workspace) then raise exception 'Preview mutated calendar';end if;
 imported=public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,request);
 calendar=(imported->>'calendarId')::uuid;
 if imported->>'revision'<>imported->>'confirmedRevision' or (select count(*) from public.workspace_bank_holidays where workspace_id=workspace)<>2 then raise exception 'Atomic confirmation failed';end if;
 if not exists(select 1 from public.annual_leave_worker_calendars where workspace_id=workspace and worker_id=worker and calendar_id=calendar) then raise exception 'Assignment failed';end if;
 if (select count(*) from rev_scheduling_private.bank_holiday_import_sources where workspace_id=workspace)<>2 then raise exception 'Provenance failed';end if;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',other_workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Cross tenant preview accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday preview changed' then raise;end if;end;
 retried=public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,request);
 if retried<>imported or (select count(*) from public.audit_log where workspace_id=workspace and action='scheduling.annual_leave_calendar.official_import')<>1 then raise exception 'Exact retry duplicated import';end if;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,member,worker,null,null,null,null,null,(review->>'previewId')::uuid,request);
  raise exception 'Member accepted';
 exception when raise_exception then if sqlerrm<>'Active owner or admin required' then raise;end if;end;
 update public.workspace_members set status='suspended' where workspace_id=workspace and user_id=actor;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,request);
  raise exception 'Suspended retry accepted';
 exception when raise_exception then if sqlerrm<>'Active owner or admin required' then raise;end if;end;
 update public.workspace_members set status='active' where workspace_id=workspace and user_id=actor;
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,events,now(),null,null);
 if (review->>'additions')::integer<>0 or (review->>'existing')::integer<>2 then raise exception 'Semantic idempotence preview failed';end if;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,request);
  raise exception 'Changed retry accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday request unavailable' then raise;end if;end;
 old_revision=(imported->>'revision')::bigint;
 imported=public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
 if (imported->>'revision')::bigint<>old_revision then raise exception 'Unchanged reimport changed revision';end if;
 -- Missing previously imported dates must be reported rather than removed or confirmed.
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,'[{"date":"2026-01-01","title":"New Year"}]',now(),null,null);
 if jsonb_array_length(review->'conflicts')<>1 then raise exception 'Missing imported date not reported';end if;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Missing imported date accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday conflicts' then raise;end if;end;
 perform public.save_rev_workspace_bank_holiday(workspace,actor,gen_random_uuid(),calendar,null,'2026-06-01','Manual company holiday','active',0);
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,events,now(),null,null);
 if jsonb_array_length(review->'preserved')<>1 then raise exception 'Manual extras not shown';end if;
 imported=public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
 if not exists(select 1 from public.workspace_bank_holidays where workspace_id=workspace and holiday_date='2026-06-01' and name='Manual company holiday' and version=1) then raise exception 'Manual extra changed';end if;
 -- A manual edit after loading invalidates the entire review.
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,events,now(),null,null);
 perform public.save_rev_workspace_bank_holiday(workspace,actor,gen_random_uuid(),calendar,null,'2026-06-02','Another manual holiday','active',0);
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Stale review accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday preview changed' then raise;end if;end;
 if exists(select 1 from public.annual_leave_calendar_years where workspace_id=workspace and confirmed_revision is not null) then raise exception 'Stale import confirmed completeness';end if;
 -- A manually added same-date entry is a conflict even when its title matches.
 perform public.save_rev_workspace_bank_holiday(workspace,actor,gen_random_uuid(),calendar,null,'2026-05-04','May holiday','active',0);
 events=events||'[{"date":"2026-05-04","title":"May holiday"},{"date":"2026-08-31","title":"Summer holiday"}]'::jsonb;
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,events,now(),null,null);
 if jsonb_array_length(review->'conflicts')<>1 then raise exception 'Manual conflict not reported';end if;
 select count(*) into before_count from public.workspace_bank_holidays where workspace_id=workspace;
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Conflicting import accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday conflicts' then raise;end if;end;
 if (select count(*) from public.workspace_bank_holidays where workspace_id=workspace)<>before_count or exists(select 1 from public.workspace_bank_holidays where workspace_id=workspace and holiday_date='2026-08-31') then raise exception 'Conflict partially imported';end if;
 for events in select value from jsonb_array_elements('[[],[{"date":"2026-02-30","title":"Invalid"}],[{"date":"2027-01-01","title":"Wrong year"}],[{"date":"2026-01-01","title":"Duplicate"},{"date":"2026-01-01","title":"Duplicate"}],[{"foo":"bad","bar":"bad"}]]'::jsonb) loop
  begin
   perform public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2026,events,now(),null,null);
   raise exception 'Invalid feed accepted';
  exception when others then if sqlerrm='Invalid feed accepted' then raise;end if;end;
 end loop;
 other_calendar=(public.configure_rev_annual_leave_calendar(other_workspace,actor,gen_random_uuid(),'save_calendar',null,null,'Scotland','GB-SCT','active',null,0)->>'calendar_id')::uuid;
 begin
  perform public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,other_calendar,'scotland',2026,'[{"date":"2026-01-01","title":"New Year"}]',now(),null,null);
  raise exception 'Cross tenant calendar accepted';
 exception when raise_exception then if sqlerrm<>'Annual leave calendar unavailable' then raise;end if;end;
 begin
  perform public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'scotland',2026,'[{"date":"2026-01-01","title":"New Year"}]',now(),null,null);
  raise exception 'Wrong region accepted';
 exception when raise_exception then if sqlerrm<>'Annual leave calendar unavailable' then raise;end if;end;
 -- Force failure after holiday insertion: confirmation must roll back every insertion and assignment.
 events='[{"date":"2028-01-01","title":"New Year"}]';
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2028,events,now(),null,null);
 execute 'create function pg_temp.refuse_confirmation() returns trigger language plpgsql as $f$ begin if new.calendar_year=2028 and new.confirmed_revision is not null then raise exception ''Forced confirmation failure'';end if;return new;end $f$';
 execute 'create trigger official_import_test_failure before update on public.annual_leave_calendar_years for each row execute function pg_temp.refuse_confirmation()';
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Forced failure not reached';
 exception when raise_exception then if sqlerrm<>'Forced confirmation failure' then raise;end if;end;
 if exists(select 1 from public.workspace_bank_holidays where workspace_id=workspace and holiday_date='2028-01-01') then raise exception 'Atomic rollback failed';end if;
 execute 'drop trigger official_import_test_failure on public.annual_leave_calendar_years';
 -- The other two official divisions use isolated calendars, not the England/Wales dates.
 for events in select value from jsonb_array_elements('[{"region":"scotland","date":"2027-01-02"},{"region":"northern-ireland","date":"2027-07-12"}]'::jsonb) loop
  review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,null,events->>'region',2027,jsonb_build_array(jsonb_build_object('date',events->>'date','title','Official regional holiday')),now(),null,null);
  imported=public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  if (imported->>'calendarId')::uuid=calendar or not exists(select 1 from public.workspace_bank_holidays where workspace_id=workspace and calendar_id=(imported->>'calendarId')::uuid and holiday_date=(events->>'date')::date) then raise exception 'Regional isolation failed';end if;
 end loop;
 review=public.import_rev_annual_leave_bank_holidays('preview',workspace,actor,worker,calendar,'england-and-wales',2029,'[{"date":"2029-01-01","title":"New Year"}]',now(),null,null);
 perform public.configure_rev_annual_leave_calendar(workspace,actor,gen_random_uuid(),'assign_worker',calendar,worker,null,null,null,null,(select version from public.annual_leave_worker_calendars where workspace_id=workspace and worker_id=worker));
 begin
  perform public.import_rev_annual_leave_bank_holidays('confirm',workspace,actor,worker,null,null,null,null,null,(review->>'previewId')::uuid,gen_random_uuid());
  raise exception 'Changed assignment accepted';
 exception when raise_exception then if sqlerrm<>'Official holiday preview changed' then raise;end if;end;
 if (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.annual_leave_accounts a)<>account_snapshot
  or (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.annual_leave_postings p)<>posting_snapshot then raise exception 'Existing accounting changed';end if;
 if has_function_privilege('authenticated','public.import_rev_annual_leave_bank_holidays(text,uuid,uuid,uuid,uuid,text,integer,jsonb,timestamptz,uuid,uuid)','EXECUTE')
  or has_table_privilege('authenticated','rev_scheduling_private.bank_holiday_import_previews','SELECT') then raise exception 'Browser authority exposed';end if;
 raise notice 'OFFICIAL_IMPORT_LOCAL_REGRESSIONS_PASS';
end $$;
rollback;
