import {WorkerUnavailabilityPanel} from './WorkerUnavailabilityPanel';
import {WorkerWorkingPatternPanel} from './WorkerWorkingPatternPanel';
import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadSchedulingWorkers,submitWorkerAttempt,rememberWorkerAttempt,restoreWorkerAttempt,clearWorkerAttempt,type Worker,type WorkerSaveAttempt} from '@/services/schedulingWorkers';
interface Draft {workerId:string|null;displayName:string;roles:string;skills:string;active:boolean;version:number;}
const blank=():Draft=>({workerId:null,displayName:'',roles:'',skills:'',active:true,version:0});
const labels=(value:string)=>value.trim()?value.split(',').map(t=>t.trim()):[];
export function SchedulingModule({workspaceId,userId}:{workspaceId:string;userId:string}){
 const [access,setAccess]=useState<'loading'|'allowed'|'denied'>('loading'),[workers,setWorkers]=useState<Worker[]>([]),[draft,setDraft]=useState<Draft>(blank),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[pending,setPending]=useState<WorkerSaveAttempt|null>(null),[storageBlocked,setStorageBlocked]=useState(false);
 const locked=useRef(false),mounted=useRef(true);
 const load=()=>loadSchedulingWorkers(workspaceId,async(columns,ws)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_workers').select(columns).eq('workspace_id',ws);if(error)throw new Error('Unavailable');return data;});
 useEffect(()=>{
  mounted.current=true;
  void(async()=>{try{
   if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
   if(!mounted.current)return;if(error||data?.status!=='active'||!['owner','admin'].includes(data.role)){setAccess('denied');return;}setAccess('allowed');
   try{const saved=restoreWorkerAttempt(window.sessionStorage,workspaceId,userId);if(mounted.current&&saved){setPending(saved);setMessage('A previous save is unconfirmed. Retry the same request to confirm its result before making another change.');}}catch{if(mounted.current){setStorageBlocked(true);setMessage('Pending save information could not be read. Contact support before adding another worker.');}}
   const list=await load();if(mounted.current){setWorkers(list);setReady(true);}
  }catch{if(mounted.current)setMessage('Scheduling could not be loaded. Refresh to try again.');}})();
  return()=>{mounted.current=false;};
 },[workspaceId,userId]);
 const save=async(retry=false)=>{
  if(locked.current||access!=='allowed'||!ready||storageBlocked)return;
  locked.current=true;setBusy(true);setMessage('');
  let attempt=pending;
  try{
   if(!attempt){if(retry)throw new Error('Missing request');attempt={workspaceId,requestId:crypto.randomUUID(),workerId:draft.workerId,displayName:draft.displayName.trim(),roleLabels:labels(draft.roles),skillTags:labels(draft.skills),active:draft.active,expectedVersion:draft.version};rememberWorkerAttempt(window.sessionStorage,userId,attempt);if(mounted.current)setPending(attempt);}
   await submitWorkerAttempt(attempt,async(name,body)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.functions.invoke(name,{body});if(error)throw new Error('Unavailable');return data;});
   clearWorkerAttempt(window.sessionStorage,workspaceId,userId);
   if(!mounted.current)return;setPending(null);setEditing(false);setDraft(blank());setMessage('Worker saved. No login account was created.');
   try{const list=await load();if(mounted.current)setWorkers(list);}catch{if(mounted.current){setReady(false);setMessage('Worker saved. Refresh to reload the worker list.');}}
  }catch{
   if(!mounted.current)return;
   setMessage(attempt&&pendingRequestExists()?'Save could not be confirmed. Do not create a replacement worker. Retry the same request to confirm its result.':'Enter a name and up to 30 unique roles or skills, separated by commas.');
   try{const list=await load();if(mounted.current)setWorkers(list);}catch{/* Retain the last list; never automatically retry a write. */}
  }finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 function pendingRequestExists(){try{return restoreWorkerAttempt(window.sessionStorage,workspaceId,userId)!==null;}catch{setStorageBlocked(true);return true;}}
 if(access==='loading')return <div className="p-6" role="status">{message||'Loading Scheduling...'}</div>;
 if(access==='denied')return <div className="p-6">Scheduling management is available to workspace owners and admins.</div>;
 return <section className="max-w-6xl mx-auto p-6"><h1 className="text-2xl font-semibold">Scheduling</h1><p className="my-3">Manage named workers in this business. Adding a worker does not give them access to REV. Availability, shifts and allocation will follow.</p>{message&&<p role="status" className="my-3">{message}</p>}
 {pending&&<button className="btn-secondary my-3" disabled={busy||storageBlocked||!ready} onClick={()=>void save(true)}>RETRY SAME SAVE</button>}
 <button className="btn-primary my-3" disabled={busy||!!pending||!ready||storageBlocked} onClick={()=>{setDraft(blank());setEditing(true);setMessage(''); requestAnimationFrame(()=>document.getElementById("worker-edit-form")?.scrollIntoView({behavior:"smooth",block:"start"}));}}>ADD WORKER</button>
 {editing&&<form id="worker-edit-form" className="card p-4 my-4" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy||!!pending||storageBlocked}><legend className="font-semibold">{draft.workerId?'Edit worker':'New worker'}</legend>
 <label className="block my-3">Worker name<input className="block border rounded p-2 w-full" required maxLength={120} value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})}/></label>
 <label className="block my-3">Roles (separated by commas)<input className="block border rounded p-2 w-full" value={draft.roles} onChange={event=>setDraft({...draft,roles:event.target.value})}/></label>
 <label className="block my-3">Skills (separated by commas)<input className="block border rounded p-2 w-full" value={draft.skills} onChange={event=>setDraft({...draft,skills:event.target.value})}/></label>
 <label className="flex gap-2 my-3"><input type="checkbox" checked={draft.active} onChange={event=>setDraft({...draft,active:event.target.checked})}/>Active worker</label>
 <button className="btn-primary" type="submit">SAVE WORKER</button><button className="btn-secondary ml-3" type="button" onClick={()=>setEditing(false)}>CANCEL</button></fieldset></form>}
 {ready&&workers.length===0&&<p>No workers recorded.</p>}
 <ul className="grid gap-4 mt-4 sm:grid-cols-2">{workers.map(worker=><li key={worker.workerId} className="card p-4"><h2 className="font-semibold">{worker.displayName}</h2><p>{worker.active?'Active':'Inactive'}</p><p>Roles: {worker.roleLabels.join(', ')||'None recorded'}</p><p>Skills: {worker.skillTags.join(', ')||'None recorded'}</p><WorkerWorkingPatternPanel key={`${workspaceId}:${userId}:${worker.workerId}`} workspaceId={workspaceId} userId={userId} workerId={worker.workerId} active={worker.active} disabled={busy||!!pending||storageBlocked||!ready} /><WorkerUnavailabilityPanel key={`${workspaceId}:${userId}:${worker.workerId}`} workspaceId={workspaceId} userId={userId} workerId={worker.workerId} active={worker.active} disabled={busy||!!pending||storageBlocked||!ready} /><button className="btn-secondary mt-3" disabled={busy||!!pending||!ready||storageBlocked} onClick={()=>{setDraft({workerId:worker.workerId,displayName:worker.displayName,roles:worker.roleLabels.join(', '),skills:worker.skillTags.join(', '),active:worker.active,version:worker.version});setEditing(true);setMessage(''); requestAnimationFrame(()=>document.getElementById("worker-edit-form")?.scrollIntoView({behavior:"smooth",block:"start"}));}}>EDIT WORKER</button></li>)}</ul>
 </section>;
}
