import {SchedulingWeeklyPlanner} from './SchedulingWeeklyPlanner';
import {SchedulingJobsPanel} from './SchedulingJobsPanel';
import {AnnualLeaveView} from './AnnualLeaveView';
import {WorkerUnavailabilityPanel} from './WorkerUnavailabilityPanel';
import {WorkerWorkingPatternPanel} from './WorkerWorkingPatternPanel';
import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadSchedulingWorkers,submitWorkerAttempt,rememberWorkerAttempt,restoreWorkerAttempt,clearWorkerAttempt,visibleSchedulingWorkers,workerStatusAttempt,workerSaveOperation,workerSaveSuccessMessage,WorkerSaveRefused,type Worker,type WorkerSaveAttempt} from '@/services/schedulingWorkers';
import {schedulingParentLock} from '@/services/schedulingRecovery';
import {loadBusinessHours} from '@/services/calendarBusinessHours';
interface Draft {workerId:string|null;displayName:string;roles:string;skills:string;active:boolean;version:number;}
const blank=():Draft=>({workerId:null,displayName:'',roles:'',skills:'',active:true,version:0});
const labels=(value:string)=>value.trim()?value.split(',').map(t=>t.trim()):[];
export function SchedulingModule({workspaceId,userId}:{workspaceId:string;userId:string}){
 const [access,setAccess]=useState<'loading'|'allowed'|'denied'>('loading'),[workers,setWorkers]=useState<Worker[]>([]),[draft,setDraft]=useState<Draft>(blank),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[pending,setPending]=useState<WorkerSaveAttempt|null>(null),[storageBlocked,setStorageBlocked]=useState(false),[showArchived,setShowArchived]=useState(false),[statusChange,setStatusChange]=useState<{worker:Worker;active:boolean}|null>(null),[view,setView]=useState<'planner'|'annual_leave'>('planner'),[workspaceTimezone,setWorkspaceTimezone]=useState<string|null>(null);
 const locked=useRef(false),mounted=useRef(true);
 const load=()=>loadSchedulingWorkers(workspaceId,async(columns,ws)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_workers').select(columns).eq('workspace_id',ws);if(error)throw new Error('Unavailable');return data;});
 useEffect(()=>{
  mounted.current=true;
  void(async()=>{try{
   if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
   if(!mounted.current)return;if(error||data?.status!=='active'||!['owner','admin'].includes(data.role)){setAccess('denied');return;}setAccess('allowed');
    try{const saved=restoreWorkerAttempt(window.sessionStorage,workspaceId,userId);if(mounted.current&&saved){setPending(saved);setMessage(`${saved.workerId?(saved.active?'A worker restore or update':'A worker archive'):'A new worker save'} for ${saved.displayName} is unconfirmed. Use the retry control at the top of Scheduling; the original request will be reused.`);}}catch{if(mounted.current){setStorageBlocked(true);setMessage('Pending save information could not be read. Contact support before adding another worker.');}}
   let timezoneWarning='';try{const policy=await loadBusinessHours(workspaceId,async(columns,ws)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('workspace_calendar_business_hours').select(columns).eq('workspace_id',ws);if(error)throw new Error('Unavailable');return data;});if(mounted.current)setWorkspaceTimezone(policy?.timezone??'Europe/London');}catch{timezoneWarning='Workspace timezone could not be loaded. Sickness recording is unavailable until it can be confirmed.';}
   const list=await load();if(mounted.current){setWorkers(list);setReady(true);if(timezoneWarning)setMessage(timezoneWarning);}
  }catch{if(mounted.current)setMessage('Scheduling could not be loaded. Refresh to try again.');}})();
  return()=>{mounted.current=false;};
 },[workspaceId,userId]);
 const save=async(retry=false,worker:Worker|null=null,active?:boolean)=>{
  if(locked.current||access!=='allowed'||!ready||storageBlocked)return;
    locked.current=true;setBusy(true);setMessage(retry?'Retrying the same worker request...':'Saving worker...');
  let attempt=pending;
  try{
     if(!attempt){if(retry)throw new Error('Missing request');attempt=worker&&typeof active==='boolean'?workerStatusAttempt(worker,crypto.randomUUID(),active):{workspaceId,requestId:crypto.randomUUID(),workerId:draft.workerId,displayName:draft.displayName.trim(),roleLabels:labels(draft.roles),skillTags:labels(draft.skills),active:draft.active,expectedVersion:draft.version};rememberWorkerAttempt(window.sessionStorage,userId,attempt);if(mounted.current)setPending(attempt);}
     const operation=workerSaveOperation(attempt,workers);
     await submitWorkerAttempt(attempt,async(name,body)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.functions.invoke(name,{body});if(error){const context=(error as {context?:unknown}).context;if(context instanceof Response&&context.status===409)return{status:409,data:await context.clone().json()};throw new Error('Uncertain result');}return{status:200,data};});
   clearWorkerAttempt(window.sessionStorage,workspaceId,userId);window.dispatchEvent(new Event('rev-scheduling-changed'));
     if(!mounted.current)return;setPending(null);setStatusChange(null);setEditing(false);setDraft(blank());setMessage(workerSaveSuccessMessage(operation));
  try{const list=await load();if(mounted.current)setWorkers(list);}catch{if(mounted.current){setReady(false);setMessage(`${workerSaveSuccessMessage(operation)} Refresh to reload the worker list.`);}}
    }catch(error){
   if(!mounted.current)return;
     if(error instanceof WorkerSaveRefused){try{clearWorkerAttempt(window.sessionStorage,workspaceId,userId);setPending(null);setStatusChange(null);setMessage(error.message);const list=await load();if(mounted.current)setWorkers(list);}catch{setStorageBlocked(true);setMessage(`${error.message} Refresh the page to reload current workers.`);}}
     else{setMessage(attempt&&pendingRequestExists()?`Outcome unconfirmed for ${attempt.displayName}. Retry the same ${attempt.workerId?(attempt.active?'restore or update':'archive'):'worker save'}; its request ID and payload are retained.`:'Enter a name and up to 30 unique roles or skills, separated by commas.');try{const list=await load();if(mounted.current)setWorkers(list);}catch{/* Retain the last list; never automatically retry a write. */}}
  }finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 function pendingRequestExists(){try{return restoreWorkerAttempt(window.sessionStorage,workspaceId,userId)!==null;}catch{setStorageBlocked(true);return true;}}
 const childLock=schedulingParentLock({busy,pendingWorkerSave:!!pending,storageBlocked,ready});
 if(access==='loading')return <div className="p-6" role="status">{message||'Loading Scheduling...'}</div>;
 if(access==='denied')return <div className="p-6">Scheduling management is available to workspace owners and admins.</div>;
 return <section className="w-full max-w-none min-w-0 overflow-x-hidden p-4 sm:p-6"><h1 className="text-2xl font-semibold">Scheduling</h1><p className="my-3">Plan work, record working hours and manage assignments in one place. Start with worker hours, then create a job and assign a suitable worker. Adding a worker does not create a login.</p>{message&&<p role="status" className="my-3">{message}</p>}
 <nav aria-label="Scheduling views" className="flex gap-2 my-3"><button className={view==='planner'?'btn-primary':'btn-secondary'} onClick={()=>setView('planner')}>WEEKLY PLANNER</button><button className={view==='annual_leave'?'btn-primary':'btn-secondary'} onClick={()=>setView('annual_leave')}>ANNUAL LEAVE</button></nav>
 {view==='annual_leave'?<AnnualLeaveView key={`annual-leave:${workspaceId}:${userId}`} workspaceId={workspaceId} userId={userId} workers={workers} disabled={childLock.editsBlocked} retryDisabled={childLock.retriesBlocked} parentDisabledReason={childLock.reason}/>:
 <>
 <SchedulingWeeklyPlanner key={`planner:${workspaceId}:${userId}`} workspaceId={workspaceId} userId={userId} workspaceTimezone={workspaceTimezone} />
 {pending&&<button className="btn-secondary my-3" disabled={busy||storageBlocked||!ready} onClick={()=>void save(true)}>{busy?'RETRYING...':pending.workerId?(pending.active?'RETRY SAME RESTORE / UPDATE':'RETRY SAME ARCHIVE'):'RETRY SAME SAVE'}</button>}
 <button className="btn-primary my-3" disabled={busy||!!pending||!ready||storageBlocked} onClick={()=>{setDraft(blank());setEditing(true);setMessage(''); requestAnimationFrame(()=>document.getElementById("worker-edit-form")?.scrollIntoView({behavior:"smooth",block:"start"}));}}>ADD WORKER</button>
 {editing&&<form id="worker-edit-form" className="card p-4 my-4" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy||!!pending||storageBlocked}><legend className="font-semibold">{draft.workerId?'Edit worker':'New worker'}</legend>
 <label className="block my-3">Worker name<input className="block border rounded p-2 w-full" required maxLength={120} value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})}/></label>
 <label className="block my-3">Roles (separated by commas)<input className="block border rounded p-2 w-full" value={draft.roles} onChange={event=>setDraft({...draft,roles:event.target.value})}/></label>
 <label className="block my-3">Skills (separated by commas)<input className="block border rounded p-2 w-full" value={draft.skills} onChange={event=>setDraft({...draft,skills:event.target.value})}/></label>
 <button className="btn-primary" type="submit">SAVE WORKER</button><button className="btn-secondary ml-3" type="button" onClick={()=>setEditing(false)}>DISCARD CHANGES</button></fieldset></form>}
 {ready&&workers.length===0&&<p>No workers recorded.</p>}
 <label className="flex gap-2 my-3 text-sm"><input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/>Show archived workers</label>
 <ul className="grid gap-4 mt-4 sm:grid-cols-2">{visibleSchedulingWorkers(workers,showArchived).map(worker=><li key={worker.workerId} id={`scheduling-worker-${worker.workerId}`} className="card p-4"><h2 className="font-semibold">{worker.displayName}</h2><p>{worker.active?'Active':'Archived'}</p><p>Roles: {worker.roleLabels.join(', ')||'None recorded'}</p><p>Skills: {worker.skillTags.join(', ')||'None recorded'}</p><WorkerWorkingPatternPanel key={`hours:${workspaceId}:${userId}:${worker.workerId}`} workspaceId={workspaceId} userId={userId} workerId={worker.workerId} active={worker.active} disabled={childLock.editsBlocked} retryDisabled={childLock.retriesBlocked} parentDisabledReason={childLock.reason} /><WorkerUnavailabilityPanel key={`leave:${workspaceId}:${userId}:${worker.workerId}`} workspaceId={workspaceId} userId={userId} workerId={worker.workerId} active={worker.active} workspaceTimezone={workspaceTimezone} disabled={childLock.editsBlocked} retryDisabled={childLock.retriesBlocked} parentDisabledReason={childLock.reason} /><button className="btn-secondary mt-3" disabled={busy||!!pending||!ready||storageBlocked||!!statusChange} onClick={()=>{setDraft({workerId:worker.workerId,displayName:worker.displayName,roles:worker.roleLabels.join(', '),skills:worker.skillTags.join(', '),active:worker.active,version:worker.version});setEditing(true);setMessage(''); requestAnimationFrame(()=>document.getElementById("worker-edit-form")?.scrollIntoView({behavior:"smooth",block:"start"}));}}>EDIT WORKER</button>{worker.active?<button className="btn-secondary mt-3 ml-2" disabled={busy||!!pending||!ready||storageBlocked||editing||!!statusChange} onClick={()=>setStatusChange({worker,active:false})}>ARCHIVE WORKER</button>:<button className="btn-secondary mt-3 ml-2" disabled={busy||!!pending||!ready||storageBlocked||editing||!!statusChange} onClick={()=>setStatusChange({worker,active:true})}>RESTORE WORKER</button>}</li>)}</ul>
 {statusChange&&<div role="group" aria-label={`${statusChange.active?'Restore':'Archive'} ${statusChange.worker.displayName}`} className="card p-4 my-4"><p className="font-medium">{statusChange.active?`Restore ${statusChange.worker.displayName}?`:`Archive ${statusChange.worker.displayName}?`}</p><p className="text-sm my-2">{statusChange.active?'They will be active and can receive new assignments.':'Their history remains. Archived workers cannot receive new assignments. Active assignments must be cancelled first; this action will not cancel work automatically.'}</p><button className="btn-secondary" disabled={busy||!!pending||storageBlocked||!ready} onClick={()=>void save(false,statusChange.worker,statusChange.active)}>{statusChange.active?'CONFIRM RESTORE':'CONFIRM ARCHIVE'}</button><button className="btn-secondary ml-2" disabled={busy} onClick={()=>setStatusChange(null)}>KEEP CURRENT STATUS</button></div>}
 <SchedulingJobsPanel key={`jobs:${workspaceId}:${userId}`} workspaceId={workspaceId} userId={userId} disabled={busy||!!pending||storageBlocked||!ready} />
 </>
 }
 </section>;
}
