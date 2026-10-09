import {useEffect,useRef,useState,type FormEvent} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {
 clearLeaveAttempt,
 clearLegacyLeaveCancelAttempt,
 LeaveSaveRefused,
 LegacyLeaveCancelRefused,
 loadAccountedLeaveIds,
 loadWorkerUnavailability,
 localLeaveToUtc,
 localSicknessDatesToUtc,
 LeaveSaveRejected,
 rememberLeaveAttempt,
 rememberLegacyLeaveCancelAttempt,
 restoreLeaveAttempt,
 restoreLegacyLeaveCancelAttempt,
 submitLeaveAttempt,
 submitLegacyLeaveCancellation,
 utcLeaveToLocal,
 utcSicknessDates,
 type LeaveAttempt,
 type LegacyLeaveCancelAttempt,
 type UnavailablePeriod,
} from '@/services/workerUnavailability';
import {loadWorkerAssignments,overlappingAssignments} from '@/services/schedulingAssignments';
import {formatSchedulingDate,formatSchedulingInstant,formatSchedulingLocal} from '@/services/schedulingDisplay';

interface Draft{record:UnavailablePeriod|null;start:string;end:string;category:'unavailable'|'sickness';}
const blank=():Draft=>({record:null,start:'',end:'',category:'unavailable'});

function periodLabel(period:UnavailablePeriod){
 return period.category==='leave'?'Leave':period.category==='sickness'?'Sickness':'Unavailable';
}

export function WorkerUnavailabilityPanel({workspaceId,userId,workerId,active,workspaceTimezone=null,disabled=false,retryDisabled=disabled,parentDisabledReason=''}:{workspaceId:string;userId:string;workerId:string;active:boolean;workspaceTimezone?:string|null;disabled?:boolean;retryDisabled?:boolean;parentDisabledReason?:string}){
 const [list,setList]=useState<UnavailablePeriod[]>([]);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [pending,setPending]=useState<LeaveAttempt|null>(null);
 const [blocked,setBlocked]=useState(false);
 const [message,setMessage]=useState('');
 const [draft,setDraft]=useState<Draft>(blank);
 const [editing,setEditing]=useState(false);
 const [cancel,setCancel]=useState<UnavailablePeriod|null>(null);
 const [timezone,setTimezone]=useState('Europe/London');
 const [timezoneInput,setTimezoneInput]=useState('Europe/London');
 const [accountedLeaveIds,setAccountedLeaveIds]=useState<Set<string>>(new Set());
 const [legacyPending,setLegacyPending]=useState<LegacyLeaveCancelAttempt|null>(null);
 const [legacyCancel,setLegacyCancel]=useState<UnavailablePeriod|null>(null);
 const lock=useRef(false),mounted=useRef(true),detailsRef=useRef<HTMLDetailsElement>(null),formRef=useRef<HTMLFormElement>(null);

 const read=()=>loadWorkerUnavailability(workspaceId,workerId,async(columns,ws,worker)=>{
  if(!supabaseClient)throw new Error('Unavailable');
  const {data,error}=await supabaseClient.from('scheduling_worker_unavailability').select(columns).eq('workspace_id',ws).eq('worker_id',worker);
  if(error)throw new Error('Unavailable');
  return data;
 });
 const readAccounted=()=>loadAccountedLeaveIds(workspaceId,workerId,async(columns,ws,worker)=>{
  if(!supabaseClient)throw new Error('Unavailable');
  const {data,error}=await supabaseClient.from('annual_leave_absences').select(columns).eq('workspace_id',ws).eq('worker_id',worker);
  if(error)throw new Error('Unavailable');
  return data;
 });
 const readAssignments=()=>loadWorkerAssignments(workspaceId,workerId,async(columns,ws,worker)=>{
  if(!supabaseClient)throw new Error('Unavailable');
  const {data,error}=await supabaseClient.from('scheduling_assignments').select(columns).eq('workspace_id',ws).eq('worker_id',worker);
  if(error)throw new Error('Unavailable');
  return data;
 });
 const sicknessConflictMessage=async(startAt:string,endAt:string)=>{
  if(!workspaceTimezone)throw new Error('Workspace timezone unavailable');
  const affected=overlappingAssignments(await readAssignments(),startAt,endAt);
  if(!affected.length)return null;
  const intervals=affected.map((assignment,index)=>`Assignment ${index+1}: ${formatSchedulingInstant(assignment.startAt,workspaceTimezone)} to ${formatSchedulingInstant(assignment.endAt,workspaceTimezone)}`).join('; ');
  return `Sickness was not saved. Cancel the affected assignments first; REV will not cancel or reassign work. Affected assignments: ${intervals}.`;
 };

 useEffect(()=>{
  mounted.current=true;
  void(async()=>{
   try{
    const saved=restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId);
    const legacy=restoreLegacyLeaveCancelAttempt(window.sessionStorage,workspaceId,userId,workerId);
    if(saved&&legacy)throw Error('Conflicting pending requests');
    if(saved&&mounted.current){setPending(saved);setMessage('A previous save is unconfirmed. Retry the same request before making another change.');}
    if(legacy&&mounted.current){setLegacyPending(legacy);setMessage('A historical leave cancellation is unconfirmed. Retry the same cancellation before making another change.');}
   }catch{
    if(mounted.current){setBlocked(true);setMessage('Pending save could not be read. Contact support.');}
   }
   try{
    const [rows,accounted]=await Promise.all([read(),readAccounted()]);
    if(mounted.current){setList(rows);setAccountedLeaveIds(accounted);setReady(true);}
   }catch{
    if(mounted.current)setMessage('Unavailable and sickness periods could not be loaded. Refresh to try again.');
   }
  })();
  return()=>{mounted.current=false;};
 },[workspaceId,userId,workerId]);

 const save=async(cancelling:UnavailablePeriod|null=null,retry=false)=>{
  if(lock.current||!ready||(retry?retryDisabled:disabled)||blocked)return;
  if(!pending&&!cancelling&&!active)return;
  lock.current=true;
  setBusy(true);
  setMessage(retry?'Retrying the same period request...':cancelling?'Cancelling period...':'Saving period...');
  let attempt=pending;
  try{
   if(!attempt){
    const existing=cancelling??draft.record;
    let startAt:string,endAt:string;
    if(cancelling){startAt=cancelling.startAt;endAt=cancelling.endAt;}
    else if(draft.category==='sickness'){
     if(!workspaceTimezone){setMessage('Sickness was not saved because the workspace timezone could not be confirmed. Refresh Scheduling and try again.');return;}
     ({startAt,endAt}=localSicknessDatesToUtc(draft.start,draft.end,workspaceTimezone));
     try{const conflict=await sicknessConflictMessage(startAt,endAt);if(conflict){setMessage(conflict);return;}}
     catch{setMessage('Sickness was not saved because assigned work could not be checked. Refresh Scheduling and try again.');return;}
    }else{
     startAt=localLeaveToUtc(draft.start,timezone);
     endAt=localLeaveToUtc(draft.end,timezone);
    }
    attempt={workspaceId,workerId,requestId:crypto.randomUUID(),unavailabilityId:existing?.unavailabilityId??null,startAt,endAt,category:cancelling?cancelling.category:draft.category,status:cancelling?'cancelled':'active',expectedVersion:existing?.version??0};
    rememberLeaveAttempt(window.sessionStorage,userId,attempt);
    if(mounted.current)setPending(attempt);
   }
   const status=attempt.status;
   await submitLeaveAttempt(attempt,async(name,body)=>{
    if(!supabaseClient)throw new Error('Unavailable');
    const {data,error}=await supabaseClient.functions.invoke(name,{body});
    if(error){
     const context=(error as {context?:unknown}).context;
     if(context instanceof Response)return{status:context.status,data:await context.clone().json().catch(()=>null)};
     throw new Error('Uncertain result');
    }
    return{status:200,data};
   });
   clearLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId);
   window.dispatchEvent(new Event('rev-scheduling-changed'));
   if(!mounted.current)return;
   setPending(null);
   setCancel(null);
   setEditing(false);
   setDraft(blank());
   setMessage(status==='cancelled'?'Period cancelled and planner refresh requested.':attempt.category==='sickness'?'Sickness dates saved and planner refresh requested. No notification was sent.':'Unavailable period saved and planner refresh requested.');
   try{const rows=await read();if(mounted.current)setList(rows);}
   catch{if(mounted.current){setReady(false);setMessage('Saved. Refresh to reload the periods.');}}
  }catch(error){
   if(!mounted.current)return;
   if(error instanceof LeaveSaveRejected){
    setMessage(`${error.message} This confirmed rejection did not record a period. The same request ID and payload remain retained; retry only after the hosted save boundary is confirmed.`);
   }else if(error instanceof LeaveSaveRefused){
    try{
     clearLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId);
     setPending(null);
     setCancel(null);
     const rows=await read();
     if(mounted.current){
      setList(rows);
      if(error.code==='assignment_conflict'&&attempt?.category==='sickness'){
       try{setMessage(await sicknessConflictMessage(attempt.startAt,attempt.endAt)??error.message);}
       catch{setMessage(`${error.message} Refresh Scheduling to review the affected assignments.`);}
      }else setMessage(error.message);
     }
    }catch{
     setReady(false);
     setMessage(`${error.message} Refresh this page to reload the current periods.`);
    }
   }else{
    let remembered=false;
    try{remembered=restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId)!==null;}
    catch{setBlocked(true);remembered=true;}
    setMessage(remembered?'Outcome still unconfirmed. Retry the same period request; its request ID and payload have been retained.':'Enter a valid period. Sickness uses inclusive workspace-local dates; unavailable periods use unambiguous local times.');
   }
  }finally{
   lock.current=false;
   if(mounted.current)setBusy(false);
  }
 };

 const cancelLegacy=async(retry=false)=>{
  if(lock.current||!ready||retryDisabled||disabled||blocked)return;
  lock.current=true;
  setBusy(true);
  setMessage(retry?'Retrying the same historical leave cancellation...':'Cancelling historical leave without changing balances...');
  let attempt=legacyPending;
  try{
   if(!attempt){
    if(!legacyCancel)throw Error('Historical leave required');
    attempt={workspaceId,workerId,unavailabilityId:legacyCancel.unavailabilityId,requestId:crypto.randomUUID(),expectedVersion:legacyCancel.version};
    rememberLegacyLeaveCancelAttempt(window.sessionStorage,userId,attempt);
    if(mounted.current)setLegacyPending(attempt);
   }
   await submitLegacyLeaveCancellation(attempt,async(name,body)=>{
    if(!supabaseClient)throw Error('Unavailable');
    const {data,error}=await supabaseClient.functions.invoke(name,{body});
    if(error){
     const context=(error as {context?:unknown}).context;
     if(context instanceof Response&&context.status===409)return{status:409,data:await context.clone().json()};
     throw Error('Uncertain result');
    }
    return{status:200,data};
   });
   clearLegacyLeaveCancelAttempt(window.sessionStorage,workspaceId,userId,workerId);
   window.dispatchEvent(new Event('rev-scheduling-changed'));
   if(!mounted.current)return;
   setLegacyPending(null);
   setLegacyCancel(null);
   setMessage('Historical leave cancelled with no balance change. Planner refresh requested.');
   const [rows,accounted]=await Promise.all([read(),readAccounted()]);
   if(mounted.current){setList(rows);setAccountedLeaveIds(accounted);}
  }catch(error){
   if(!mounted.current)return;
   if(error instanceof LegacyLeaveCancelRefused){
    clearLegacyLeaveCancelAttempt(window.sessionStorage,workspaceId,userId,workerId);
    setLegacyPending(null);
    setLegacyCancel(null);
    setMessage(error.message);
    try{const [rows,accounted]=await Promise.all([read(),readAccounted()]);if(mounted.current){setList(rows);setAccountedLeaveIds(accounted);}}
    catch{setReady(false);}
   }else setMessage('Historical leave cancellation outcome is unconfirmed. Retry the same cancellation request.');
  }finally{
   lock.current=false;
   if(mounted.current)setBusy(false);
  }
 };

 const editPeriod=(period:UnavailablePeriod)=>{
  try{
   if(period.category==='sickness'){
    if(!workspaceTimezone)throw new Error('Workspace timezone unavailable');
    const dates=utcSicknessDates(period.startAt,period.endAt,workspaceTimezone);
    setDraft({record:period,start:dates.firstDate,end:dates.lastDate,category:'sickness'});
   }else{
    setDraft({record:period,start:utcLeaveToLocal(period.startAt,timezone),end:utcLeaveToLocal(period.endAt,timezone),category:'unavailable'});
   }
   setEditing(true);
   requestAnimationFrame(()=>{detailsRef.current?.setAttribute('open','');formRef.current?.scrollIntoView?.({behavior:'smooth',block:'nearest'});formRef.current?.querySelector<HTMLElement>('select,input')?.focus();});
  }catch{
   setMessage('This sickness record cannot be edited until its workspace-local dates can be confirmed. It remains readable and can still be cancelled.');
  }
 };
 const startAdding=()=>{
  setDraft(blank());
  setMessage('');
  setEditing(true);
  requestAnimationFrame(()=>{detailsRef.current?.setAttribute('open','');formRef.current?.scrollIntoView?.({behavior:'smooth',block:'nearest'});formRef.current?.querySelector<HTMLElement>('select')?.focus();});
 };
 const submitDraft=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  if(!draft.start||!draft.end){setMessage(draft.category==='sickness'?'Choose both inclusive sickness dates.':'Enter both the unavailable start and end times.');return;}
  if(draft.category==='sickness'){
   if(!workspaceTimezone){setMessage('Sickness cannot be saved until the workspace timezone is confirmed.');return;}
   try{localSicknessDatesToUtc(draft.start,draft.end,workspaceTimezone);}
   catch(error){setMessage(error instanceof Error?error.message:'Choose valid inclusive sickness dates.');return;}
  }
  setMessage('');
  void save();
 };
 const controlsDisabled=busy||!!pending||!!legacyPending||disabled||blocked||!ready;
 const disabledReason=busy?'A save is in progress. Wait for its result.':blocked?'Pending request details cannot be read. Contact support before changing periods.':!ready?'Periods are not ready. Refresh this page to reload them.':disabled?parentDisabledReason||'Another scheduling change is unresolved. Recover it from Scheduling before changing periods.':pending?'This save outcome is unconfirmed. Use RETRY SAME PERIOD SAVE; editing would change the retained payload.':legacyPending?'This cancellation outcome is unconfirmed. Use RETRY HISTORICAL LEAVE CANCELLATION.':!active?'This worker is inactive. Reactivate the worker before adding or editing periods.':cancel||legacyCancel?'Finish or keep the pending cancellation before using other controls.':editing?'Save or discard the current edit before using timezone or cancellation controls.':'';

 return <details ref={detailsRef} open={editing||undefined} onToggle={event=>{if(editing&&!event.currentTarget.open)event.currentTarget.open=true;}} className="border-t mt-4 pt-3 overflow-visible">
  <summary className="font-medium cursor-pointer">Leave, sickness and unavailable periods</summary>
  {message&&<p role="status" className="my-2">{message}</p>}
  {disabledReason&&<p className="text-sm my-2">Controls unavailable: {disabledReason}</p>}
  <label className="block my-2">Unavailable-period display/input timezone<input className="block border rounded p-2 w-full" title={disabledReason||undefined} value={timezoneInput} disabled={controlsDisabled||editing||!!cancel} onChange={event=>setTimezoneInput(event.target.value)}/></label>
  <button className="btn-secondary" title={disabledReason||undefined} disabled={controlsDisabled||editing||!!cancel} onClick={()=>{try{new Intl.DateTimeFormat('en-GB',{timeZone:timezoneInput});setTimezone(timezoneInput);setMessage('Timezone applied.');}catch{setMessage('Use a valid timezone such as Europe/London.');}}}>APPLY TIMEZONE</button>
  <p className="text-sm my-2">Unavailable times are shown in {timezone}. Sickness uses inclusive dates in {workspaceTimezone??'the confirmed workspace timezone'}. Stored intervals use an exclusive end. No calendar event or notification is created.</p>
  {!workspaceTimezone&&<p className="text-sm text-amber-800 my-2">Sickness recording is unavailable because the workspace timezone could not be confirmed.</p>}
  <button type="button" className="btn-secondary my-2" title={disabledReason||undefined} disabled={controlsDisabled||!active||!!cancel} onClick={startAdding}>ADD UNAVAILABLE / SICKNESS</button>
  {pending&&<button className="btn-secondary my-2" title={retryDisabled?disabledReason||undefined:undefined} disabled={busy||retryDisabled||blocked||!ready} onClick={()=>void save(null,true)}>{busy?'RETRYING...':'RETRY SAME PERIOD SAVE'}</button>}
  {legacyPending&&<button className="btn-secondary my-2" title={retryDisabled?disabledReason||undefined:undefined} disabled={busy||retryDisabled||blocked||!ready} onClick={()=>void cancelLegacy(true)}>{busy?'RETRYING...':'RETRY HISTORICAL LEAVE CANCELLATION'}</button>}
  {editing&&<form ref={formRef} aria-label={draft.record?'Edit unavailable or sickness period':'Record unavailable or sickness period'} noValidate className="relative z-10 mt-3 w-full overflow-visible rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm" onSubmit={submitDraft}>
   <fieldset className="min-w-0" disabled={controlsDisabled||!active} title={disabledReason||undefined}>
    <legend className="px-1 font-semibold text-slate-900">{draft.record?'Edit period':'New period'}</legend>
    <label className="block my-2 font-medium">Unavailable / Sickness<select className="mt-1 block w-full border rounded p-2 bg-white" value={draft.category} onChange={event=>{setMessage('');setDraft({...draft,start:'',end:'',category:event.target.value as Draft['category']});}}><option value="unavailable">Unavailable</option><option value="sickness" disabled={!workspaceTimezone}>Sickness</option></select></label>
    {draft.category==='sickness'?<>
     <label className="block my-2 font-medium">First sickness date (inclusive, {workspaceTimezone})<input className="mt-1 block w-full border rounded p-2 bg-white" type="date" value={draft.start} onChange={event=>{setMessage('');setDraft({...draft,start:event.target.value});}}/></label>
     <label className="block my-2 font-medium">Last sickness date (inclusive, {workspaceTimezone})<input className="mt-1 block w-full border rounded p-2 bg-white" type="date" value={draft.end} onChange={event=>{setMessage('');setDraft({...draft,end:event.target.value});}}/></label>
     <p className="text-sm my-2">Only sickness dates are recorded. Do not enter diagnoses, symptoms, medical notes or other health details. REV will list conflicting assignments and will not cancel or reassign them.</p>
    </>:<>
     <label className="block my-2 font-medium">Start ({timezone})<input className="mt-1 block w-full border rounded p-2 bg-white" type="datetime-local" value={draft.start} onChange={event=>{setMessage('');setDraft({...draft,start:event.target.value});}}/></label>
     <label className="block my-2 font-medium">End ({timezone})<input className="mt-1 block w-full border rounded p-2 bg-white" type="datetime-local" value={draft.end} onChange={event=>{setMessage('');setDraft({...draft,end:event.target.value});}}/></label>
    </>}
    <div className="mt-3 flex flex-wrap gap-2"><button className="btn-primary" type="submit">{busy?'SAVING...':'SAVE'}</button>
    <button className="btn-secondary" type="button" onClick={()=>{setDraft(blank());setEditing(false);setMessage('Changes discarded. No unavailable or sickness period was changed.');}}>DISCARD CHANGES</button></div>
   </fieldset>
  </form>}
  <ul className="space-y-3 mt-3">{list.map(period=>{
   let dates:string|null=null;
   if(period.category==='sickness'&&workspaceTimezone){try{const value=utcSicknessDates(period.startAt,period.endAt,workspaceTimezone);dates=`${formatSchedulingDate(value.firstDate)} to ${formatSchedulingDate(value.lastDate)} inclusive (${workspaceTimezone})`;}catch{dates=null;}}
   return <li key={period.unavailabilityId} className="border rounded p-3">
    <p>{periodLabel(period)} · {period.status}</p>
    <p>{dates??`${formatSchedulingLocal(utcLeaveToLocal(period.startAt,timezone))} to ${formatSchedulingLocal(utcLeaveToLocal(period.endAt,timezone))} (${timezone})`}</p>
    {period.status==='active'&&period.category!=='leave'&&<><button className="btn-secondary mt-2" disabled={controlsDisabled||!active||!!cancel||!!legacyCancel} onClick={()=>editPeriod(period)}>EDIT PERIOD</button><button className="btn-secondary mt-2 ml-2" disabled={controlsDisabled||editing} onClick={()=>setCancel(period)}>CANCEL PERIOD</button></>}
    {period.status==='active'&&period.category==='leave'&&(accountedLeaveIds.has(period.unavailabilityId)?<p className="text-sm mt-2">Recorded annual leave — cancel through Annual Leave for an exact balance reversal.</p>:<button className="btn-secondary mt-2" disabled={controlsDisabled||editing||!!cancel} onClick={()=>setLegacyCancel(period)}>CANCEL HISTORICAL LEAVE (NO BALANCE CHANGE)</button>)}
   </li>;
  })}</ul>
  {cancel&&<div role="group" aria-label="Confirm period cancellation" className="my-3"><p>Cancel this {cancel.category==='sickness'?'sickness':'unavailable'} period? Its history will remain recorded. No work will be cancelled or reassigned.</p><button className="btn-secondary" disabled={controlsDisabled} onClick={()=>void save(cancel)}>CONFIRM CANCELLATION</button><button className="btn-secondary ml-2" disabled={controlsDisabled} onClick={()=>setCancel(null)}>KEEP PERIOD</button></div>}
  {legacyCancel&&<div role="group" aria-label="Confirm historical leave cancellation" className="my-3"><p>Cancel this historical leave? Dates and history remain recorded. No annual-leave balance will be deducted or credited.</p><button className="btn-secondary" disabled={controlsDisabled} onClick={()=>void cancelLegacy()}>CONFIRM HISTORICAL LEAVE CANCELLATION</button><button className="btn-secondary ml-2" disabled={controlsDisabled} onClick={()=>setLegacyCancel(null)}>KEEP HISTORICAL LEAVE</button></div>}
  {ready&&list.length===0&&<p className="text-sm my-2">No leave, sickness or unavailable periods recorded.</p>}
 </details>;
}
