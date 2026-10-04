import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {localLeaveToUtc} from '@/services/workerUnavailability';
import {clearAnnualLeaveAttempt,createAnnualLeaveScopeGuard,expectedAccountsForDates,formatAnnualLeaveInstant,formatLeaveDays,formatLeaveMinutes,loadAnnualLeavePages,loadAnnualLeaveWorkspace,rememberAnnualLeaveAttempt,restoreAnnualLeaveAttempt,submitAnnualLeaveAttempt,AnnualLeaveRefused,type AnnualLeaveAbsence,type AnnualLeaveAccount,type AnnualLeaveAttempt,type AnnualLeaveOperation,type AnnualLeaveTable,type AnnualLeaveWorkspaceModel,type LegacyAnnualLeave} from '@/services/annualLeave';
import type {Worker} from '@/services/schedulingWorkers';

interface Drafts {
 policyScope:'workspace'|'worker';
 policyYear:string;
 allowanceUnit:'hours'|'days';
 allowanceValue:string;
 hoursPerDay:string;
 yearMonth:string;
 yearDay:string;
 holidayTreatment:'included'|'additional';
 accountStart:string;
 adjustmentMinutes:string;
 adjustmentReason:string;
 calendarName:string;
 calendarRegion:string;
 calendarId:string;
 calendarYear:string;
 holidayDate:string;
 holidayName:string;
 recordMode:'full'|'partial';
 startDate:string;
 endDate:string;
 startTime:string;
 endTime:string;
}
const initialDrafts=():Drafts=>({policyScope:'workspace',policyYear:String(new Date().getFullYear()),allowanceUnit:'days',allowanceValue:'28',hoursPerDay:'450',yearMonth:'1',yearDay:'1',holidayTreatment:'included',accountStart:`${new Date().getFullYear()}-01-01`,adjustmentMinutes:'',adjustmentReason:'',calendarName:'',calendarRegion:'GB-ENG',calendarId:'',calendarYear:String(new Date().getFullYear()),holidayDate:'',holidayName:'',recordMode:'full',startDate:'',endDate:'',startTime:'09:00',endTime:'17:00'});
const addDay=(value:string)=>new Date(Date.parse(value+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const subtractDay=(value:string)=>new Date(Date.parse(value+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const invoke=async(name:string,body:Record<string,unknown>)=>{
 if(!supabaseClient)throw Error('Unavailable');
 const {data,error}=await supabaseClient.functions.invoke(name,{body});
 if(error){const context=(error as {context?:unknown}).context;if(context instanceof Response&&context.status===409)return{status:409,data:await context.clone().json()};throw Error('Uncertain result');}
 return{status:200,data};
};
function accountLabel(account:AnnualLeaveAccount){return `${account.leaveYearStart} to ${subtractDay(account.leaveYearEndExclusive)}`;}
export function AnnualLeaveBalance({account}:{account:AnnualLeaveAccount}){
 return <section aria-label="Authoritative leave balance" className="grid gap-3 sm:grid-cols-4">
  <div className="card p-3"><strong>Allowance</strong><p>{formatLeaveMinutes(account.configuredAllowanceMinutes)}</p><small>{formatLeaveDays(account.configuredAllowanceMinutes,account.hoursPerDayMinutes)}</small></div>
  <div className="card p-3"><strong>Adjustments</strong><p>{formatLeaveMinutes(account.adjustmentTotalMinutes)}</p></div>
  <div className="card p-3"><strong>Net leave recorded</strong><p>{formatLeaveMinutes(account.recordedLeaveMinutes)}</p></div>
  <div className="card p-3"><strong>Remaining</strong><p>{formatLeaveMinutes(account.remainingMinutes)}</p><small>{formatLeaveDays(account.remainingMinutes,account.hoursPerDayMinutes)}</small></div>
 </section>;
}
export function AnnualLeaveHistory({absences,legacy,legacyDisplayTimezone,onCancel,onCancelLegacy,disabled}:{absences:AnnualLeaveAbsence[];legacy:LegacyAnnualLeave[];legacyDisplayTimezone:string;onCancel:(absence:AnnualLeaveAbsence)=>void;onCancelLegacy:(leave:LegacyAnnualLeave)=>void;disabled:boolean}){
 if(absences.length===0&&legacy.length===0)return <p>No leave history recorded for this worker.</p>;
 return <ul className="grid gap-3">{absences.map(absence=><li className="card p-3" key={absence.absenceId}><strong>Confirmed manager-recorded annual leave</strong><p>{formatAnnualLeaveInstant(absence.startAt,absence.timezone)} to {formatAnnualLeaveInstant(absence.endAt,absence.timezone)} (stored timezone: {absence.timezone})</p><p>Authoritative deduction: {formatLeaveMinutes(absence.totalDeductionMinutes)}. Status: {absence.status}.</p>{absence.status==='confirmed'&&<button className="btn-secondary mt-2" disabled={disabled} onClick={()=>onCancel(absence)}>CANCEL AND REVERSE EXACT ACCOUNTING</button>}</li>)}
 {legacy.map(leave=><li className="card p-3" key={leave.unavailabilityId}><strong>Historical leave — outside balance accounting</strong><p>{formatAnnualLeaveInstant(leave.startAt,legacyDisplayTimezone)} to {formatAnnualLeaveInstant(leave.endAt,legacyDisplayTimezone)} (display timezone: {legacyDisplayTimezone}; historical timezone was not stored). Status: {leave.status}.</p>{leave.status==='active'&&<button className="btn-secondary mt-2" disabled={disabled} onClick={()=>onCancelLegacy(leave)}>CANCEL HISTORICAL LEAVE (NO BALANCE CHANGE)</button>}</li>)}</ul>;
}
export function AnnualLeaveView({workspaceId,userId,workers,disabled:parentDisabled=false,retryDisabled=parentDisabled,parentDisabledReason=''}:{workspaceId:string;userId:string;workers:Worker[];disabled?:boolean;retryDisabled?:boolean;parentDisabledReason?:string}){
 const defaultWorkerId=workers.find(worker=>worker.active)?.workerId??workers[0]?.workerId??'',scope=`${workspaceId}:${userId}`;
 const [workerId,setWorkerId]=useState(defaultWorkerId),[model,setModel]=useState<AnnualLeaveWorkspaceModel|null>(null),[yearStart,setYearStart]=useState(''),[drafts,setDrafts]=useState<Drafts>(initialDrafts),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<AnnualLeaveAttempt|null>(null),[storageBlocked,setStorageBlocked]=useState(false),[refreshing,setRefreshing]=useState(false);
 const loadSequence=useRef(0),locked=useRef(false),scopeGuard=useRef(createAnnualLeaveScopeGuard(scope)),selectedWorkerIdRef=useRef(workerId);
 scopeGuard.current.update(scope);selectedWorkerIdRef.current=workerId;
 const read=async(table:AnnualLeaveTable,columns:string,ws:string,worker:string,accountIds?:string[])=>{
  const client=supabaseClient;if(!client)throw Error('Unavailable');
  if(table==='annual_leave_postings'&&!accountIds?.length)return[];
  return loadAnnualLeavePages(table,async(from,to,orderColumns)=>{
   let query=client.from(table).select(columns).eq('workspace_id',ws);
   if(['annual_leave_accounts','annual_leave_adjustments','annual_leave_absences','annual_leave_calculation_segments','annual_leave_worker_calendars','scheduling_worker_patterns','scheduling_worker_unavailability'].includes(table))query=query.eq('worker_id',worker);
   if(table==='annual_leave_policies')query=query.or(`worker_id.is.null,worker_id.eq.${worker}`);
   if(table==='annual_leave_postings')query=query.in('account_id',accountIds!);
   if(table==='scheduling_worker_unavailability')query=query.eq('category','leave');
   for(const column of orderColumns)query=query.order(column,{ascending:true});
   const {data,error}=await query.range(from,to);if(error)throw Error('Annual leave page unavailable; no partial data shown.');return data;
  });
 };
 const load=async(targetWorker=workerId)=>{
  if(!targetWorker)return false;
  const sequence=++loadSequence.current,token=scopeGuard.current.capture();setRefreshing(true);setMessage('Loading authoritative annual leave records...');
  try{const value=await loadAnnualLeaveWorkspace(workspaceId,targetWorker,read);if(!scopeGuard.current.isCurrent(token)||sequence!==loadSequence.current||targetWorker!==selectedWorkerIdRef.current)return false;setModel(value);setYearStart(current=>value.accounts.some(account=>account.leaveYearStart===current)?current:value.accounts[0]?.leaveYearStart??'');setDrafts(current=>({...current,calendarId:value.assignedCalendarId??value.calendars.find(calendar=>calendar.status==='active')?.calendarId??current.calendarId}));setMessage('');return true;}
  catch(error){if(scopeGuard.current.isCurrent(token)&&sequence===loadSequence.current){setModel(null);const detail=error instanceof Error&&(error.message.includes('no partial data shown')||error.message.includes('safety limit'))?error.message:'Authoritative annual leave data is unavailable or does not reconcile.';setMessage(`${detail} No leave change can be submitted.`);}return false;}
  finally{if(scopeGuard.current.isCurrent(token)&&sequence===loadSequence.current)setRefreshing(false);}
 };
 useEffect(()=>{scopeGuard.current.activate();return()=>scopeGuard.current.deactivate();},[]);
 useEffect(()=>{loadSequence.current++;locked.current=false;setPending(null);setStorageBlocked(false);setModel(null);setYearStart('');setDrafts(initialDrafts());setBusy(false);setRefreshing(false);setMessage('');let nextWorker=defaultWorkerId;try{const saved=restoreAnnualLeaveAttempt(window.sessionStorage,workspaceId,userId);if(saved){setPending(saved);nextWorker=saved.workerId;setMessage('An annual leave change has an unknown outcome. Retry exactly the same request before making another change.');}}catch{setStorageBlocked(true);setMessage('Pending annual leave recovery data could not be read. Contact support before making changes.');}setWorkerId(nextWorker);},[workspaceId,userId]);
 useEffect(()=>{setModel(null);if(workerId)void load(workerId);},[workspaceId,userId,workerId]);
 const run=async(operation:AnnualLeaveOperation,body:Record<string,unknown>,retry=false)=>{
  if(locked.current||refreshing||storageBlocked||!workerId||(retry?retryDisabled:parentDisabled)||(!retry&&!model))return;
  const token=scopeGuard.current.capture(),attemptUserId=userId;locked.current=true;setBusy(true);let attempt=pending;
  try{
   if(!attempt){if(retry)throw Error('Pending request unavailable');const requestId=crypto.randomUUID();attempt={operation,workspaceId,workerId,requestId,body:{...body,workspaceId,requestId}};rememberAnnualLeaveAttempt(window.sessionStorage,userId,attempt);setPending(attempt);}
   const submittedAttempt=attempt;await submitAnnualLeaveAttempt(submittedAttempt,invoke);
   if(!scopeGuard.current.isCurrent(token))return;
   clearAnnualLeaveAttempt(window.sessionStorage,submittedAttempt.workspaceId,attemptUserId);setPending(null);
   if(['record','cancel','legacy_cancel'].includes(submittedAttempt.operation))window.dispatchEvent(new Event('rev-scheduling-changed'));
   const success=submittedAttempt.operation==='record'?'Annual leave confirmed. Balances and planner refresh requested.':submittedAttempt.operation==='cancel'?'Annual leave cancelled with an exact reversal. Balances and planner refresh requested.':submittedAttempt.operation==='legacy_cancel'?'Historical leave cancelled with no balance change. Planner refresh requested.':'Annual leave setup saved.',reloaded=await load(submittedAttempt.workerId);
   if(scopeGuard.current.isCurrent(token))setMessage(reloaded?success:`${success} Refresh to reload authoritative annual leave records.`);
  }catch(error){
   if(!scopeGuard.current.isCurrent(token))return;
   if(error instanceof AnnualLeaveRefused&&attempt){clearAnnualLeaveAttempt(window.sessionStorage,attempt.workspaceId,attemptUserId);setPending(null);const reloaded=await load(workerId);if(scopeGuard.current.isCurrent(token))setMessage(reloaded?error.message:`${error.message} Refresh to reload authoritative annual leave records.`);}
   else setMessage('Outcome unknown. The exact request ID and payload are retained; use RETRY SAME ANNUAL LEAVE CHANGE.');
  }finally{if(scopeGuard.current.isCurrent(token)){locked.current=false;setBusy(false);}}
 };
 const refresh=async()=>{if(locked.current||busy||refreshing||!workerId)return;const token=scopeGuard.current.capture(),reloaded=await load(workerId);if(reloaded&&scopeGuard.current.isCurrent(token))setMessage('Authoritative annual leave records refreshed. No pending request was submitted.');};
 const account=model?.accounts.find(value=>value.leaveYearStart===yearStart)??null,calendar=model?.calendars.find(value=>value.calendarId===drafts.calendarId)??null,selectedWorker=workers.find(worker=>worker.workerId===workerId)??null;
 const update=<K extends keyof Drafts>(key:K,value:Drafts[K])=>setDrafts(current=>({...current,[key]:value}));
 const savePolicy=()=>{const allowance=Number(drafts.allowanceValue),hoursPerDay=Number(drafts.hoursPerDay),allowanceMinutes=drafts.allowanceUnit==='hours'?allowance*60:allowance*hoursPerDay,scopeWorker=drafts.policyScope==='worker'?workerId:null,latest=model?.policies.filter(policy=>policy.workerId===scopeWorker).sort((a,b)=>b.version-a.version)[0];if(!Number.isFinite(allowance)||!Number.isSafeInteger(allowanceMinutes))return setMessage('Allowance must convert exactly to whole minutes.');void run('policy',{workerId:scopeWorker,effectiveFromLeaveYear:Number(drafts.policyYear),allowanceInputUnit:drafts.allowanceUnit,allowanceInputValue:allowance,allowanceMinutes,hoursPerDayMinutes:hoursPerDay,leaveYearStartMonth:Number(drafts.yearMonth),leaveYearStartDay:Number(drafts.yearDay),bankHolidayTreatment:drafts.holidayTreatment,expectedVersion:latest?.version??0});};
 const openAccount=()=>void run('account',{workerId,leaveYearStart:drafts.accountStart,expectedVersion:0});
 const saveAdjustment=()=>{if(!account)return;void run('adjustment',{accountId:account.accountId,adjustmentMinutes:Number(drafts.adjustmentMinutes),reason:drafts.adjustmentReason.trim(),expectedVersion:account.version});};
 const saveCalendar=()=>void run('calendar',{action:'save_calendar',calendarId:null,name:drafts.calendarName.trim(),regionCode:drafts.calendarRegion.trim().toUpperCase(),status:'active',expectedVersion:0});
 const assignCalendar=()=>void run('calendar',{action:'assign_worker',workerId,calendarId:drafts.calendarId,expectedVersion:model?.assignmentVersion??0});
 const saveHoliday=(status:'active'|'cancelled',holiday?:{holidayId:string;holidayDate:string;name:string;version:number})=>void run('holiday',{calendarId:drafts.calendarId,holidayId:holiday?.holidayId??null,holidayDate:holiday?.holidayDate??drafts.holidayDate,name:holiday?.name??drafts.holidayName.trim(),status,expectedVersion:holiday?.version??0});
 const confirmYear=()=>{const calendarYear=Number(drafts.calendarYear),entry=model?.calendarYears.find(value=>value.calendarId===drafts.calendarId&&value.calendarYear===calendarYear);void run('calendar',{action:'confirm_year',calendarId:drafts.calendarId,calendarYear,expectedVersion:entry?.revision??0});};
 const record=()=>{if(!model||!model.timezone)return setMessage('A single authoritative working-pattern timezone is required.');const startDate=drafts.startDate,endDate=drafts.endDate||drafts.startDate;try{const startAt=localLeaveToUtc(`${startDate}T${drafts.recordMode==='full'?'00:00':drafts.startTime}`,model.timezone),endAt=localLeaveToUtc(`${drafts.recordMode==='full'?addDay(endDate):endDate}T${drafts.recordMode==='full'?'00:00':drafts.endTime}`,model.timezone),lastAccountDate=drafts.recordMode==='partial'&&drafts.endTime==='00:00'?subtractDay(endDate):endDate,expectedAccounts=expectedAccountsForDates(model,startDate,lastAccountDate);if(startAt>=endAt)throw Error('Invalid interval');void run('record',{workerId,startAt,endAt,expectedAccounts});}catch(error){setMessage(error instanceof Error?error.message:'Valid leave dates are required.');}};
 const cancelAbsence=(absence:AnnualLeaveAbsence)=>{if(!model)return;const expectedAccounts=absence.accountIds.map(accountId=>{const found=model.accounts.find(value=>value.accountId===accountId);if(!found)throw Error('Required account unavailable');return{accountId,version:found.version};});void run('cancel',{absenceId:absence.absenceId,expectedVersion:absence.version,expectedAccounts});};
 const cancelLegacy=(leave:LegacyAnnualLeave)=>void run('legacy_cancel',{workerId,unavailabilityId:leave.unavailabilityId,expectedVersion:leave.version});
 const disabled=parentDisabled||busy||refreshing||!!pending||storageBlocked||!model;
 return <section aria-labelledby="annual-leave-title" className="mt-4"><h2 id="annual-leave-title" className="text-xl font-semibold">Annual Leave</h2><p className="my-2">Manager-recorded leave is confirmed immediately. This is not an employee request or approval workflow.</p>
  {parentDisabledReason&&<p className="my-2 text-sm">{parentDisabledReason}</p>}
  {message&&<p role="status" className="my-3">{message}</p>}
  <button className="btn-secondary my-3" disabled={busy||refreshing||!workerId} onClick={()=>void refresh()}>{refreshing?'REFRESHING...':'REFRESH AUTHORITATIVE LEAVE DATA'}</button>
  {pending&&<button className="btn-secondary my-3 ml-2" disabled={busy||refreshing||storageBlocked||retryDisabled} onClick={()=>void run(pending.operation,pending.body,true)}>{busy?'RETRYING...':'RETRY SAME ANNUAL LEAVE CHANGE'}</button>}
  <div className="grid gap-3 sm:grid-cols-2"><label>Worker<select className="block border rounded p-2 w-full" value={workerId} disabled={busy||refreshing||!!pending} onChange={event=>setWorkerId(event.target.value)}><option value="">Select worker</option>{workers.map(worker=><option value={worker.workerId} key={worker.workerId}>{worker.displayName}{worker.active?'':' (archived)'}</option>)}</select></label>
  <label>Leave year<select className="block border rounded p-2 w-full" value={yearStart} disabled={!model} onChange={event=>setYearStart(event.target.value)}><option value="">Select leave year</option>{model?.accounts.map(value=><option key={value.accountId} value={value.leaveYearStart}>{accountLabel(value)}</option>)}</select></label></div>
  {account?<AnnualLeaveBalance account={account}/>:<p className="my-3">No authoritative account is available for the selected leave year. Recording is disabled until setup is complete.</p>}
  <details className="card p-4 my-4"><summary className="font-semibold cursor-pointer">POLICY, ACCOUNT AND BALANCE ADJUSTMENT SETUP</summary><fieldset disabled={disabled} className="mt-3">
   <h3 className="font-medium">Policy</h3><div className="grid gap-2 sm:grid-cols-3"><label>Policy scope<select value={drafts.policyScope} onChange={event=>update('policyScope',event.target.value as Drafts['policyScope'])}><option value="workspace">Workspace default</option><option value="worker">Selected worker override</option></select></label><label>First leave-year label<input type="number" value={drafts.policyYear} onChange={event=>update('policyYear',event.target.value)}/></label><label>Allowance unit<select value={drafts.allowanceUnit} onChange={event=>update('allowanceUnit',event.target.value as Drafts['allowanceUnit'])}><option value="days">Days</option><option value="hours">Hours</option></select></label><label>Allowance<input type="number" step="0.0001" value={drafts.allowanceValue} onChange={event=>update('allowanceValue',event.target.value)}/></label><label>Explicit minutes per day<input type="number" value={drafts.hoursPerDay} onChange={event=>update('hoursPerDay',event.target.value)}/></label><label>Leave year starts<input aria-label="Leave year start month" type="number" min="1" max="12" value={drafts.yearMonth} onChange={event=>update('yearMonth',event.target.value)}/><input aria-label="Leave year start day" type="number" min="1" max="31" value={drafts.yearDay} onChange={event=>update('yearDay',event.target.value)}/></label><label>Bank holidays<select value={drafts.holidayTreatment} onChange={event=>update('holidayTreatment',event.target.value as Drafts['holidayTreatment'])}><option value="included">Included in allowance</option><option value="additional">Additional to allowance</option></select></label></div><button type="button" className="btn-secondary mt-2" onClick={savePolicy}>SAVE POLICY</button>
   <h3 className="font-medium mt-4">Open leave-year account</h3><label>Leave year starts<input type="date" value={drafts.accountStart} onChange={event=>update('accountStart',event.target.value)}/></label><button type="button" className="btn-secondary ml-2" onClick={openAccount}>OPEN ACCOUNT</button>
   <h3 className="font-medium mt-4">Adjustment</h3><p className="text-sm">Use signed integer minutes. The current account conversion is {account?formatLeaveMinutes(account.hoursPerDayMinutes):'unavailable'} per day.</p><label>Adjustment minutes (+/-)<input type="number" value={drafts.adjustmentMinutes} onChange={event=>update('adjustmentMinutes',event.target.value)}/></label><label>Reason<input maxLength={500} value={drafts.adjustmentReason} onChange={event=>update('adjustmentReason',event.target.value)}/></label><button type="button" className="btn-secondary mt-2" disabled={!account} onClick={saveAdjustment}>SAVE ADJUSTMENT</button>
   {account&&<ul className="mt-3">{model?.adjustments.filter(value=>value.accountId===account.accountId).map(value=><li key={value.adjustmentId}>{formatLeaveMinutes(value.minutes)} — {value.reason}</li>)}</ul>}
  </fieldset></details>
  <details className="card p-4 my-4"><summary className="font-semibold cursor-pointer">CALENDAR, WORKER ASSIGNMENT AND HOLIDAY SETUP</summary><fieldset disabled={disabled} className="mt-3">
   <label>New calendar name<input value={drafts.calendarName} onChange={event=>update('calendarName',event.target.value)}/></label><label>Region code<input value={drafts.calendarRegion} onChange={event=>update('calendarRegion',event.target.value)}/></label><button type="button" className="btn-secondary ml-2" onClick={saveCalendar}>CREATE CALENDAR</button>
   <label className="block mt-3">Calendar<select value={drafts.calendarId} onChange={event=>update('calendarId',event.target.value)}><option value="">Select calendar</option>{model?.calendars.filter(value=>value.status==='active').map(value=><option value={value.calendarId} key={value.calendarId}>{value.name} ({value.regionCode})</option>)}</select></label><button type="button" className="btn-secondary mt-2" disabled={!calendar} onClick={assignCalendar}>ASSIGN SELECTED WORKER</button>
   <div className="mt-3"><label>Holiday date<input type="date" value={drafts.holidayDate} onChange={event=>update('holidayDate',event.target.value)}/></label><label>Holiday name<input value={drafts.holidayName} onChange={event=>update('holidayName',event.target.value)}/></label><button type="button" className="btn-secondary ml-2" disabled={!calendar} onClick={()=>saveHoliday('active')}>ADD HOLIDAY</button></div>
   <div className="mt-3"><label>Calendar year to confirm complete<input type="number" min="1000" max="9999" value={drafts.calendarYear} onChange={event=>update('calendarYear',event.target.value)}/></label><button type="button" className="btn-secondary ml-2" disabled={!calendar} onClick={confirmYear}>CONFIRM YEAR COMPLETE</button>{model?.calendarYears.filter(value=>value.calendarId===drafts.calendarId).map(value=><p key={value.calendarYear}>{value.calendarYear}: revision {value.revision}, {value.confirmedRevision===value.revision?'confirmed complete':'confirmation required'}.</p>)}</div>
   <ul className="mt-3">{model?.holidays.filter(value=>value.calendarId===drafts.calendarId).map(holiday=><li key={holiday.holidayId}>{holiday.holidayDate}: {holiday.name} ({holiday.status}) {holiday.status==='active'&&<button type="button" className="btn-secondary ml-2" onClick={()=>saveHoliday('cancelled',holiday)}>CANCEL HOLIDAY</button>}</li>)}</ul>
  </fieldset></details>
  <details open className="card p-4 my-4"><summary className="font-semibold cursor-pointer">RECORD CONFIRMED ANNUAL LEAVE</summary><fieldset disabled={disabled||!account||!selectedWorker?.active} className="mt-3"><p>Worker timezone: <strong>{model?.timezone??'Unavailable'}</strong>. The server calculates the authoritative deduction after submission; no browser estimate is shown.</p>{selectedWorker&&!selectedWorker.active&&<p>This worker is archived. Existing leave can be reviewed or cancelled, but new leave cannot be recorded.</p>}<label>Leave duration<select value={drafts.recordMode} onChange={event=>update('recordMode',event.target.value as Drafts['recordMode'])}><option value="full">Full day(s)</option><option value="partial">Partial day / exact local times</option></select></label><label>First date<input type="date" value={drafts.startDate} onChange={event=>update('startDate',event.target.value)}/></label><label>Last date<input type="date" value={drafts.endDate} onChange={event=>update('endDate',event.target.value)}/></label>{drafts.recordMode==='partial'&&<><label>Local start time<input type="time" value={drafts.startTime} onChange={event=>update('startTime',event.target.value)}/></label><label>Local end time<input type="time" value={drafts.endTime} onChange={event=>update('endTime',event.target.value)}/></label></>}<button type="button" className="btn-primary ml-2" onClick={record}>RECORD AND CONFIRM LEAVE</button></fieldset></details>
  <section><h3 className="font-semibold">Leave history</h3><AnnualLeaveHistory absences={model?.absences??[]} legacy={model?.legacyLeave??[]} legacyDisplayTimezone={model?.timezone??'UTC'} disabled={disabled} onCancel={cancelAbsence} onCancelLegacy={cancelLegacy}/></section>
 </section>;
}
