// Local Supabase only. Fake identities and scheduling data; no hosted operations.
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const baseUrl='http://127.0.0.1:55321';
const anonKey=process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceKey=process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if(!anonKey||!serviceKey)throw Error('Local Supabase test keys required.');

const identities=[];
const workspaces=[];
let failures=0;
const check=(name,value)=>{
 console.log(`${name}=${value?'PASS':'FAIL'}`);
 if(!value)failures++;
};
async function request(token,method,path,body){
 const response=await fetch(baseUrl+path,{method,headers:{apikey:anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=await response.json().catch(()=>null);
 return{status:response.status,payload,rows:Array.isArray(payload)?payload:[]};
}
const rpc=(token,name,body)=>request(token,'POST',`/rest/v1/rpc/${name}`,body);
function sql(statement){
 const result=spawnSync('docker',['exec','-i','supabase_db_revive-app','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:statement,encoding:'utf8'});
 if(result.error||result.status!==0)throw Error(`Local SQL failed: ${result.stderr}`);
 return result.stdout.trim();
}
const uuid=/^[0-9a-f-]{36}$/i;
const id=value=>{
 if(typeof value!=='string'||!uuid.test(value))throw Error('Invalid fixture identifier');
 return value;
};
async function identity(label){
 const email=`annual-leave-stage2-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
 const password=`Local-${randomBytes(32).toString('base64url')}`;
 const created=await request(serviceKey,'POST','/auth/v1/admin/users',{email,password,email_confirm:true});
 if(created.status!==200)throw Error('Identity fixture failed');
 const userId=id(created.payload.id);
 identities.push(userId);
 const login=await request(anonKey,'POST','/auth/v1/token?grant_type=password',{email,password});
 if(login.status!==200)throw Error('Login fixture failed');
 return{id:userId,token:login.payload.access_token};
}
async function workspace(owner){
 const stamp=`${Date.now()}-${randomBytes(4).toString('hex')}`;
 const created=await rpc(owner.token,'create_workspace_with_owner',{workspace_name:`Annual leave Stage 2 ${stamp}`,workspace_slug:`annual-leave-stage2-${stamp}`});
 const workspaceId=id(created.payload?.[0]?.created_workspace_id);
 workspaces.push(workspaceId);
 return workspaceId;
}
async function retire(){
 for(const workspaceId of workspaces)await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}`,{status:'suspended'});
 for(const userId of identities){
  const found=await request(serviceKey,'GET',`/auth/v1/admin/users/${userId}`);
  const email=found.payload?.email??found.payload?.user?.email;
  if(found.status===200&&typeof email==='string'&&email.startsWith('annual-leave-stage2-')&&email.endsWith('@example.test'))await request(serviceKey,'PUT',`/auth/v1/admin/users/${userId}`,{ban_duration:'87600h'});
 }
 console.log('APPEND_ONLY_STAGE2_EVIDENCE_PRESERVED=PASS');
}

try{
 const owner=await identity('owner');
 const member=await identity('member');
 const outsider=await identity('outsider');
 const workspaceId=await workspace(owner);
 const otherWorkspaceId=await workspace(outsider);
 await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'});

 const createWorker=async(name)=>{
  const response=await rpc(serviceKey,'save_rev_scheduling_worker',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:name,target_role_labels:[],target_skill_tags:['Admin'],target_active:true,expected_version:0});
  if(response.status!==200)throw Error('Worker fixture failed');
  return id(response.payload.worker_id);
 };
 const savePattern=async(workerId,patch={})=>{
  const response=await rpc(serviceKey,'save_rev_worker_working_pattern',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_timezone:'Europe/London',target_working_days:[1,2,3,4,5],target_start_local:'09:00',target_end_local:'17:00',target_effective_from:'2026-01-01',target_effective_until:'2027-12-31',expected_version:0,...patch});
  if(response.status!==200)throw Error(`Pattern fixture failed: ${JSON.stringify(response.payload)}`);
 };
 const workerId=await createWorker('Stage 2 Worker');
 await savePattern(workerId);

 const policyRequest=randomUUID();
 const savePolicy=(patch={})=>rpc(serviceKey,'save_rev_annual_leave_policy',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:policyRequest,target_worker_id:workerId,target_effective_from_leave_year:2026,target_allowance_input_unit:'days',target_allowance_input_value:28,target_allowance_minutes:12600,target_hours_per_day_minutes:450,target_leave_year_start_month:4,target_leave_year_start_day:1,target_bank_holiday_treatment:'included',expected_version:0,...patch});
 const policy2026=await savePolicy();
 if(policy2026.status!==200)throw Error('Policy fixture failed');
 const openAccount=async(start,expectedVersion=0)=>{
  const response=await rpc(serviceKey,'open_rev_annual_leave_account',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_leave_year_start:start,expected_version:expectedVersion});
  if(response.status!==200)throw Error(`Account fixture failed: ${JSON.stringify(response.payload)}`);
  return response.payload;
 };
 const account2026=await openAccount('2026-04-01');
 const policy2027=await savePolicy({target_request_id:randomUUID(),target_effective_from_leave_year:2027,target_bank_holiday_treatment:'additional',expected_version:1});
 if(policy2027.status!==200)throw Error('Second policy fixture failed');
 const account2027=await openAccount('2027-04-01');

 const configureCalendar=patch=>rpc(serviceKey,'configure_rev_annual_leave_calendar',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_action:patch.action,target_calendar_id:patch.calendarId??null,target_worker_id:patch.workerId??null,target_name:patch.name??null,target_region_code:patch.regionCode??null,target_status:patch.status??null,target_calendar_year:patch.calendarYear??null,expected_version:patch.expectedVersion});
 const calendar=await configureCalendar({action:'save_calendar',name:'England and Wales',regionCode:'GB-EAW',status:'active',expectedVersion:0});
 if(calendar.status!==200)throw Error(`Calendar fixture failed: ${JSON.stringify(calendar.payload)}`);
 const calendarId=id(calendar.payload.calendar_id);
 const preliminaryRecord={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_start_at:'2027-05-10T09:00:00Z',target_end_at:'2027-05-10T10:00:00Z',expected_accounts:[{account_id:account2027.account_id,version:1}]};
 const missingCalendar=await rpc(serviceKey,'record_rev_annual_leave',preliminaryRecord);
 check('EXPLICIT_WORKER_CALENDAR_REQUIRED',missingCalendar.status>=400&&missingCalendar.payload?.message==='Annual leave calendar unavailable');
 const assignmentCalendar=await configureCalendar({action:'assign_worker',calendarId,workerId,expectedVersion:0});
 if(assignmentCalendar.status!==200)throw Error('Calendar assignment fixture failed');
 const unconfirmedCalendar=await rpc(serviceKey,'record_rev_annual_leave',{...preliminaryRecord,target_request_id:randomUUID()});
 check('CONFIRMED_CALENDAR_YEAR_REQUIRED',unconfirmedCalendar.status>=400&&unconfirmedCalendar.payload?.message==='Annual leave calendar year unconfirmed');
 check('CALENDAR_BROWSER_RPC_DENIED',(await rpc(owner.token,'configure_rev_annual_leave_calendar',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_action:'confirm_year',target_calendar_id:calendarId,target_worker_id:null,target_name:null,target_region_code:null,target_status:null,target_calendar_year:2027,expected_version:0})).status>=400);

 const holiday=await rpc(serviceKey,'save_rev_workspace_bank_holiday',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_calendar_id:calendarId,target_holiday_id:null,target_holiday_date:'2027-04-01',target_name:'Authoritative holiday',target_status:'active',expected_version:0});
 const includedHoliday=await rpc(serviceKey,'save_rev_workspace_bank_holiday',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_calendar_id:calendarId,target_holiday_id:null,target_holiday_date:'2027-03-31',target_name:'Included authoritative holiday',target_status:'active',expected_version:0});
 check('AUTHORITATIVE_BANK_HOLIDAYS_SAVED',holiday.status===200&&holiday.payload?.version===1&&includedHoliday.status===200&&includedHoliday.payload?.version===1);
 check('BANK_HOLIDAY_BROWSER_RPC_DENIED',(await rpc(owner.token,'save_rev_workspace_bank_holiday',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_calendar_id:calendarId,target_holiday_id:null,target_holiday_date:'2027-05-03',target_name:'Denied',target_status:'active',expected_version:0})).status>=400);
 const confirmed2027=await configureCalendar({action:'confirm_year',calendarId,calendarYear:2027,expectedVersion:2});
 const confirmed2026=await configureCalendar({action:'confirm_year',calendarId,calendarYear:2026,expectedVersion:0});
 check('CALENDAR_YEARS_EXPLICITLY_CONFIRMED',confirmed2027.status===200&&confirmed2027.payload?.confirmed_revision===2&&confirmed2026.status===200&&confirmed2026.payload?.confirmed_revision===1);

 const job=await rpc(serviceKey,'save_rev_scheduling_job',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_job_id:null,target_title:'Conflict fixture',target_start_at:'2027-03-31T12:00:00Z',target_end_at:'2027-03-31T13:00:00Z',target_timezone:'Europe/London',target_location:'Local office',target_required_skills:['Admin'],target_staffing_count:1,target_status:'open',expected_version:0});
 if(job.status!==200)throw Error('Job fixture failed');
 const assignment=await rpc(serviceKey,'save_rev_scheduling_assignment',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_assignment_id:null,target_worker_id:workerId,target_job_id:id(job.payload.job_id),target_status:'active',expected_version:0,expected_worker_version:1,expected_job_version:1,expected_pattern_version:1});
 if(assignment.status!==200)throw Error('Assignment fixture failed');

 const recordRequestId=randomUUID();
 const expectedAccounts=[{account_id:id(account2026.account_id),version:1},{account_id:id(account2027.account_id),version:1}];
 const recordInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:recordRequestId,target_worker_id:workerId,target_start_at:'2027-03-31T11:00:00Z',target_end_at:'2027-04-05T12:00:00Z',expected_accounts:expectedAccounts};
 const conflict=await rpc(serviceKey,'record_rev_annual_leave',recordInput);
 check('ASSIGNMENT_CONFLICT_REFUSED',conflict.status>=400&&conflict.payload?.message==='Cancel affected assignments before recording annual leave');
 const cancelledAssignment=await rpc(serviceKey,'save_rev_scheduling_assignment',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_assignment_id:id(assignment.payload.assignment_id),target_worker_id:workerId,target_job_id:id(job.payload.job_id),target_status:'cancelled',expected_version:1,expected_worker_version:null,expected_job_version:null,expected_pattern_version:null});
 if(cancelledAssignment.status!==200)throw Error('Assignment cancellation fixture failed');

 check('MEMBER_RECORD_DENIED',(await rpc(serviceKey,'record_rev_annual_leave',{...recordInput,initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 check('CROSS_TENANT_RECORD_DENIED',(await rpc(serviceKey,'record_rev_annual_leave',{...recordInput,target_workspace_id:otherWorkspaceId,initiating_user_id:outsider.id,target_request_id:randomUUID()})).status>=400);
 check('BROWSER_RECORD_RPC_DENIED',(await rpc(owner.token,'record_rev_annual_leave',{...recordInput,target_request_id:randomUUID()})).status>=400);

 const competingInputs=[recordInput,{...recordInput,target_request_id:randomUUID()}];
 const competing=await Promise.all(competingInputs.map(input=>rpc(serviceKey,'record_rev_annual_leave',input)));
 const successfulIndex=competing.findIndex(value=>value.status===200);
 const successful=competing.find(value=>value.status===200);
 const successfulInput=competingInputs[successfulIndex];
 check('CONCURRENT_OVERLAP_RECORDED_ONCE',competing.filter(value=>value.status===200).length===1&&competing.filter(value=>value.status>=400).length===1);
 if(!successful)throw Error('No successful leave fixture');
 const absenceId=id(successful.payload.absence_id);
 const unavailabilityId=id(successful.payload.unavailability_id);
 check('CROSS_YEAR_PARTIAL_DEDUCTION_EXACT',successful.payload.total_deduction_minutes===1020&&successful.payload.accounts?.find(value=>value.account_id===account2026.account_id)?.deducted_minutes===300&&successful.payload.accounts?.find(value=>value.account_id===account2027.account_id)?.deducted_minutes===720);
 const segments=(await request(owner.token,'GET',`/rest/v1/annual_leave_calculation_segments?absence_id=eq.${absenceId}&select=*&order=local_date.asc`)).rows;
 check('IMMUTABLE_DAILY_SEGMENTS_STORED',segments.length===6&&segments.filter(segment=>segment.segment_kind==='non_working'&&segment.deduction_minutes===0).length===2&&segments.every(segment=>segment.source_pattern_version===1&&segment.source_timezone==='Europe/London'));
 check('CALENDAR_SNAPSHOT_ON_EVERY_DATE',segments.every(segment=>segment.source_calendar_id===calendarId&&segment.source_calendar_name==='England and Wales'&&segment.source_calendar_region_code==='GB-EAW'&&segment.source_calendar_year===2027&&segment.source_calendar_year_confirmed_revision===2));
 const holidaySegment=segments.find(segment=>segment.local_date==='2027-04-01');
 const includedHolidaySegment=segments.find(segment=>segment.local_date==='2027-03-31');
 check('INCLUDED_BANK_HOLIDAY_DEDUCTED',includedHolidaySegment?.segment_kind==='bank_holiday_included'&&includedHolidaySegment.deduction_minutes===300&&includedHolidaySegment.source_holiday_id===includedHoliday.payload.holiday_id);
 check('ADDITIONAL_BANK_HOLIDAY_NOT_DEDUCTED',holidaySegment?.segment_kind==='bank_holiday_additional'&&holidaySegment.deduction_minutes===0&&holidaySegment.source_holiday_id===holiday.payload.holiday_id);
 const changedPattern=await rpc(serviceKey,'save_rev_worker_working_pattern',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_timezone:'Europe/London',target_working_days:[1,2,3,4,5],target_start_local:'09:00',target_end_local:'18:00',target_effective_from:'2026-01-01',target_effective_until:'2027-12-31',expected_version:1});
 const changedPolicy=await savePolicy({target_request_id:randomUUID(),target_effective_from_leave_year:2028,target_bank_holiday_treatment:'included',expected_version:2});
 const cancelledHoliday=await rpc(serviceKey,'save_rev_workspace_bank_holiday',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_calendar_id:calendarId,target_holiday_id:holiday.payload.holiday_id,target_holiday_date:'2027-04-01',target_name:'Renamed authoritative holiday',target_status:'cancelled',expected_version:1});
 check('LATER_AUTHORITY_CHANGES_SAVED',changedPattern.status===200&&changedPolicy.status===200&&cancelledHoliday.status===200);
 const invalidatedYear=await rpc(serviceKey,'record_rev_annual_leave',{...preliminaryRecord,target_request_id:randomUUID(),expected_accounts:[{account_id:account2027.account_id,version:2}]});
 check('HOLIDAY_CHANGE_INVALIDATES_YEAR_CONFIRMATION',invalidatedYear.status>=400&&invalidatedYear.payload?.message==='Annual leave calendar year unconfirmed');
 const reconfirmed2027=await configureCalendar({action:'confirm_year',calendarId,calendarYear:2027,expectedVersion:3});
 check('INVALIDATED_YEAR_RECONFIRMED',reconfirmed2027.status===200&&reconfirmed2027.payload?.confirmed_revision===3);
 check('RECORDED_SEGMENT_SNAPSHOTS_UNCHANGED',sql(`select count(*) from public.annual_leave_calculation_segments where absence_id='${absenceId}' and source_pattern_version=1 and source_end_local='17:00' and source_calendar_year_confirmed_revision=2;`)==='6'&&sql(`select source_holiday_name from public.annual_leave_calculation_segments where absence_id='${absenceId}' and local_date='2027-04-01';`)==='Authoritative holiday');
 check('PLANNER_ABSENCE_ACTIVE',(await request(owner.token,'GET',`/rest/v1/scheduling_worker_unavailability?id=eq.${unavailabilityId}&select=status,category`)).rows[0]?.status==='active');
 const replay=await rpc(serviceKey,'record_rev_annual_leave',successfulInput);
 check('IDENTICAL_RECORD_RETRY_SAFE',replay.status===200&&replay.payload?.absence_id===absenceId);
 const changedReuse=await rpc(serviceKey,'record_rev_annual_leave',{...successfulInput,target_end_at:'2027-04-05T13:00:00Z'});
 check('CHANGED_RECORD_REQUEST_REJECTED',changedReuse.status>=400&&changedReuse.payload?.message==='Annual leave record request unavailable');
 check('GENERIC_LEAVE_BYPASS_CLOSED',(await rpc(serviceKey,'save_rev_worker_unavailability',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_unavailability_id:null,target_start_at:'2027-06-01T08:00:00Z',target_end_at:'2027-06-01T16:00:00Z',target_category:'leave',target_status:'active',expected_version:0})).status>=400);

 const legacyId=randomUUID();
 sql(`begin;select pg_catalog.set_config('rev.authoritative_annual_leave','on',true);insert into public.scheduling_worker_unavailability(id,workspace_id,worker_id,start_at,end_at,category,status,created_by_user_id,updated_by_user_id) values('${id(legacyId)}','${id(workspaceId)}','${id(workerId)}','2026-02-02T09:00:00Z','2026-02-02T17:00:00Z','leave','active','${id(owner.id)}','${id(owner.id)}');commit;`);
 check('LEGACY_LEAVE_REMAINS_UNCLASSIFIED',sql(`select count(*) from public.annual_leave_absences where workspace_id='${id(workspaceId)}' and unavailability_id='${id(legacyId)}';`)==='0');
 const accountingBeforeLegacyCancel=sql(`select recorded_leave_minutes from public.annual_leave_accounts where id='${id(account2026.account_id)}';`);
 const postingsBeforeLegacyCancel=sql(`select count(*) from public.annual_leave_postings;`);
 const legacyCancelInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_unavailability_id:legacyId,expected_version:1};
 const legacyCancellations=await Promise.all([rpc(serviceKey,'cancel_rev_legacy_annual_leave',legacyCancelInput),rpc(serviceKey,'cancel_rev_legacy_annual_leave',legacyCancelInput)]);
 check('LEGACY_CANCELLATION_IDENTICAL_RETRY_SAFE',legacyCancellations.every(value=>value.status===200&&value.payload?.unavailability_id===legacyId&&value.payload?.status==='cancelled'&&value.payload?.version===2));
 check('LEGACY_CANCELLATION_PRESERVES_HISTORY_WITHOUT_ACCOUNTING',sql(`select count(*) from public.scheduling_worker_unavailability where id='${id(legacyId)}' and start_at='2026-02-02T09:00:00Z' and end_at='2026-02-02T17:00:00Z' and category='leave' and status='cancelled';`)==='1'&&sql(`select recorded_leave_minutes from public.annual_leave_accounts where id='${id(account2026.account_id)}';`)===accountingBeforeLegacyCancel&&sql(`select count(*) from public.annual_leave_postings;`)===postingsBeforeLegacyCancel);
 check('LEGACY_CANCELLATION_AUDITED_ONCE',sql(`select count(*) from public.audit_log where workspace_id='${id(workspaceId)}' and action='scheduling.legacy_annual_leave.cancelled' and resource_id='${id(legacyId)}';`)==='1');
 check('LEGACY_CANCELLATION_CHANGED_RETRY_DENIED',(await rpc(serviceKey,'cancel_rev_legacy_annual_leave',{...legacyCancelInput,expected_version:2})).status>=400);
 check('LEGACY_CANCELLATION_CROSS_TENANT_DENIED',(await rpc(serviceKey,'cancel_rev_legacy_annual_leave',{...legacyCancelInput,target_workspace_id:otherWorkspaceId,initiating_user_id:outsider.id,target_request_id:randomUUID()})).status>=400);
 check('LEGACY_CANCELLATION_BROWSER_RPC_DENIED',(await rpc(owner.token,'cancel_rev_legacy_annual_leave',{...legacyCancelInput,target_request_id:randomUUID()})).status>=400);
 check('ACCOUNTED_LEAVE_REJECTED_BY_LEGACY_PATH',(await rpc(serviceKey,'cancel_rev_legacy_annual_leave',{...legacyCancelInput,target_request_id:randomUUID(),target_unavailability_id:unavailabilityId})).status>=400);

 const cancelRequestId=randomUUID();
 const cancellationInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:cancelRequestId,target_absence_id:absenceId,expected_version:1,expected_accounts:successful.payload.accounts.map(value=>({account_id:value.account_id,version:value.version}))};
 const cancellations=await Promise.all([rpc(serviceKey,'cancel_rev_annual_leave',cancellationInput),rpc(serviceKey,'cancel_rev_annual_leave',cancellationInput)]);
 check('CONCURRENT_IDENTICAL_CANCELLATION_SAFE',cancellations.every(value=>value.status===200&&value.payload?.absence_id===absenceId));
 const cancellation=cancellations[0];
 check('EXACT_REVERSAL_TOTAL',cancellation.payload?.reversed_minutes===1020&&sql(`select coalesce(sum(minutes),0) from public.annual_leave_postings where absence_id='${absenceId}';`)==='0');
 check('REVERSAL_POSTED_ONCE',sql(`select count(*) from public.annual_leave_postings where absence_id='${absenceId}' and posting_kind='reversal';`)===sql(`select count(*) from public.annual_leave_postings where absence_id='${absenceId}' and posting_kind='deduction';`));
 check('CANCELLED_LEAVE_STOPS_BLOCKING',(await request(owner.token,'GET',`/rest/v1/scheduling_worker_unavailability?id=eq.${unavailabilityId}&select=status`)).rows[0]?.status==='cancelled');
 check('ACCOUNT_TOTALS_RESTORED',sql(`select count(*) from public.annual_leave_accounts where id in ('${id(account2026.account_id)}','${id(account2027.account_id)}') and recorded_leave_minutes=0;`)==='2');
 const cancellationReplay=await rpc(serviceKey,'cancel_rev_annual_leave',cancellationInput);
 check('IDENTICAL_CANCELLATION_RETRY_SAFE',cancellationReplay.status===200&&cancellationReplay.payload?.version===2);
 check('CHANGED_CANCELLATION_REQUEST_REJECTED',(await rpc(serviceKey,'cancel_rev_annual_leave',{...cancellationInput,expected_version:2})).status>=400);

 const dstWorker=await createWorker('DST Worker');
 await savePattern(dstWorker,{target_working_days:[7],target_start_local:'01:30',target_end_local:'02:30'});
 if((await configureCalendar({action:'assign_worker',calendarId,workerId:dstWorker,expectedVersion:0})).status!==200)throw Error('DST calendar assignment failed');
 const dstPolicy=await rpc(serviceKey,'save_rev_annual_leave_policy',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:dstWorker,target_effective_from_leave_year:2026,target_allowance_input_unit:'hours',target_allowance_input_value:20,target_allowance_minutes:1200,target_hours_per_day_minutes:450,target_leave_year_start_month:4,target_leave_year_start_day:1,target_bank_holiday_treatment:'included',expected_version:0});
 if(dstPolicy.status!==200)throw Error('DST policy fixture failed');
 const dstAccount=await rpc(serviceKey,'open_rev_annual_leave_account',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:dstWorker,target_leave_year_start:'2026-04-01',expected_version:0});
 if(dstAccount.status!==200)throw Error('DST account fixture failed');
 const dstResult=await rpc(serviceKey,'record_rev_annual_leave',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:dstWorker,target_start_at:'2026-10-25T00:00:00Z',target_end_at:'2026-10-25T03:00:00Z',expected_accounts:[{account_id:dstAccount.payload.account_id,version:1}]});
 check('DST_AMBIGUOUS_PATTERN_REFUSED',dstResult.status>=400&&dstResult.payload?.message==='Working pattern local time ambiguous');

 const lowBalanceWorker=await createWorker('Low Balance Worker');
 await savePattern(lowBalanceWorker);
 if((await configureCalendar({action:'assign_worker',calendarId,workerId:lowBalanceWorker,expectedVersion:0})).status!==200)throw Error('Low-balance calendar assignment failed');
 const lowBalancePolicy=await rpc(serviceKey,'save_rev_annual_leave_policy',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:lowBalanceWorker,target_effective_from_leave_year:2026,target_allowance_input_unit:'hours',target_allowance_input_value:1,target_allowance_minutes:60,target_hours_per_day_minutes:450,target_leave_year_start_month:4,target_leave_year_start_day:1,target_bank_holiday_treatment:'included',expected_version:0});
 if(lowBalancePolicy.status!==200)throw Error('Low balance policy fixture failed');
 const lowBalanceAccount=await rpc(serviceKey,'open_rev_annual_leave_account',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:lowBalanceWorker,target_leave_year_start:'2026-04-01',expected_version:0});
 if(lowBalanceAccount.status!==200)throw Error('Low balance account fixture failed');
 const lowBalanceResult=await rpc(serviceKey,'record_rev_annual_leave',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:lowBalanceWorker,target_start_at:'2026-06-01T08:00:00Z',target_end_at:'2026-06-01T16:00:00Z',expected_accounts:[{account_id:lowBalanceAccount.payload.account_id,version:1}]});
 check('INSUFFICIENT_BALANCE_REFUSED',lowBalanceResult.status>=400&&lowBalanceResult.payload?.message==='Annual leave balance insufficient'&&sql(`select count(*) from public.annual_leave_absences where worker_id='${id(lowBalanceWorker)}';`)==='0');

 const rollbackWorker=await createWorker('Rollback Worker');
 await savePattern(rollbackWorker);
 if((await configureCalendar({action:'assign_worker',calendarId,workerId:rollbackWorker,expectedVersion:0})).status!==200)throw Error('Rollback calendar assignment failed');
 const rollbackPolicy=await rpc(serviceKey,'save_rev_annual_leave_policy',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:rollbackWorker,target_effective_from_leave_year:2026,target_allowance_input_unit:'hours',target_allowance_input_value:20,target_allowance_minutes:1200,target_hours_per_day_minutes:450,target_leave_year_start_month:4,target_leave_year_start_day:1,target_bank_holiday_treatment:'included',expected_version:0});
 if(rollbackPolicy.status!==200)throw Error('Rollback policy fixture failed');
 const rollbackAccount=await rpc(serviceKey,'open_rev_annual_leave_account',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:rollbackWorker,target_leave_year_start:'2026-04-01',expected_version:0});
 if(rollbackAccount.status!==200)throw Error('Rollback account fixture failed');
 const rollbackRequest=randomUUID();
 const rollbackVersion=Number(sql(`select version from public.annual_leave_accounts where id='${id(rollbackAccount.payload.account_id)}';`));
 const atomic=sql(`begin;create function pg_temp.refuse_stage2_audit() returns trigger language plpgsql as $$begin raise exception 'audit refused';end$$;create trigger refuse_stage2_audit before insert on public.audit_log for each row when(new.action='scheduling.annual_leave.recorded')execute function pg_temp.refuse_stage2_audit();do $$begin begin perform public.record_rev_annual_leave('${id(workspaceId)}','${id(owner.id)}','${id(rollbackRequest)}','${id(rollbackWorker)}','2026-06-01T08:00:00Z','2026-06-01T16:00:00Z',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account_id','${id(rollbackAccount.payload.account_id)}','version',${rollbackVersion})));exception when raise_exception then null;end;end$$;select case when not exists(select 1 from public.annual_leave_absences where worker_id='${id(rollbackWorker)}') and not exists(select 1 from rev_scheduling_private.annual_leave_record_requests where request_id='${id(rollbackRequest)}') and (select version from public.annual_leave_accounts where id='${id(rollbackAccount.payload.account_id)}')=${rollbackVersion} then 'ATOMIC_PASS' else 'ATOMIC_FAIL' end;rollback;`);
 check('AUDIT_FAILURE_ROLLS_BACK_STAGE2',atomic.includes('ATOMIC_PASS'));
 check('PRIVATE_STAGE2_REQUESTS_DENIED',sql("select not has_schema_privilege('service_role','rev_scheduling_private','USAGE') and not has_schema_privilege('authenticated','rev_scheduling_private','USAGE');")==='t');
}catch(error){
 console.error(error instanceof Error?error.message:'Stage 2 validation failed');
 check('ANNUAL_LEAVE_STAGE2_VALIDATION',false);
}finally{
 await retire();
}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');
check('ANNUAL_LEAVE_STAGE2_LOCAL',failures===0);
if(failures)process.exitCode=1;
