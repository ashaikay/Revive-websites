import {useEffect,useRef,useState,type ReactNode} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadSchedulingWorkers,type Worker} from '@/services/schedulingWorkers';
import {loadWorkingPattern} from '@/services/workerWorkingPatterns';
import type {SchedulingJob} from '@/services/schedulingJobs';
import {loadAssignments,submitAssignmentAttempt,rememberAssignment,restoreAssignment,clearAssignment,AllocationRefused,AssignmentOutcomeUnknown,type Assignment,type AssignmentAttempt,type AssignmentInvoke} from '@/services/schedulingAssignments';
import {loadPlannerData,workerSuitability,type PlannerData} from '@/services/schedulingPlanner';

type Action='assign'|'cancel'|'retry'|'refresh';
type Feedback={action:Action;tone:'success'|'error';text:string}|null;
type Recovery='restored'|'transport'|'server'|'malformed'|'storage'|null;
type FocusTarget='confirm'|'recovery'|'feedback'|null;

const workingLabels:Record<Action,string>={assign:'Assigning…',cancel:'Cancelling…',retry:'Retrying…',refresh:'Refreshing…'};

const invokeSave:AssignmentInvoke=async(name,body)=>{
 if(!supabaseClient)throw Error('Unavailable');
 const {data,error}=await supabaseClient.functions.invoke(name,{body});
 if(!error)return {status:200,data};
 // An HTTP reply (including refusals) carries its Response; anything else never reached a reply.
 const context=(error as {context?:unknown}).context;
 if(context instanceof Response){let payload:unknown=null;try{payload=await context.clone().json();}catch{payload=null;}return {status:context.status,data:payload};}
 throw Error('No response');
};

function revealIfNeeded(element:HTMLElement){
 if(typeof element.scrollIntoView!=='function')return;
 const box=element.getBoundingClientRect();
 if(box.top<0||box.bottom>window.innerHeight)element.scrollIntoView({block:'nearest',behavior:'smooth'});
}

export function JobAssignmentsPanel({workspaceId,userId,job,disabled=false,when,note,jobActions}:{workspaceId:string;userId:string;job:SchedulingJob;disabled?:boolean;when?:string;note?:ReactNode;jobActions?:ReactNode}){
 const [workers,setWorkers]=useState<Worker[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[planner,setPlanner]=useState<PlannerData|null>(null),[ready,setReady]=useState(false),[loadFailed,setLoadFailed]=useState(false),[working,setWorking]=useState<Action|null>(null),[blocked,setBlocked]=useState(false),[pending,setPending]=useState<AssignmentAttempt|null>(null),[recovery,setRecovery]=useState<Recovery>(null),[selected,setSelected]=useState(''),[cancel,setCancel]=useState<Assignment|null>(null),[feedback,setFeedback]=useState<Feedback>(null),[needsHours,setNeedsHours]=useState<string|null>(null);
 const mounted=useRef(true),lock=useRef(false),focusNext=useRef<FocusTarget>(null),confirmRef=useRef<HTMLButtonElement|null>(null),recoveryRef=useRef<HTMLDivElement|null>(null),feedbackRef=useRef<HTMLParagraphElement|null>(null);
 const ids=`job-${job.jobId}`;
 const readWorkers=()=>loadSchedulingWorkers(workspaceId,async(columns,ws)=>{if(!supabaseClient)throw Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_workers').select(columns).eq('workspace_id',ws);if(error)throw Error('Unavailable');return data;});
 const reload=async()=>{const [people,rows,schedule]=await Promise.all([readWorkers(),loadAssignments(workspaceId,job.jobId,async(columns,ws,id)=>{if(!supabaseClient)throw Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_assignments').select(columns).eq('workspace_id',ws).eq('job_id',id);if(error)throw Error('Unavailable');return data;}),loadPlannerData(workspaceId,async(table,columns,ws,from,to)=>{if(!supabaseClient)throw Error('Unavailable');const {data,error}=await supabaseClient.from(table).select(columns).eq('workspace_id',ws).order('id',{ascending:true}).range(from,to);if(error)throw Error('Unavailable');return data;})]);if(mounted.current){setWorkers(people);setAssignments(rows);setPlanner(schedule);setReady(true);setLoadFailed(false);}return rows;};
 useEffect(()=>{mounted.current=true;void(async()=>{try{const a=restoreAssignment(window.sessionStorage,workspaceId,userId,job.jobId);if(a&&mounted.current){setPending(a);setRecovery('restored');}}catch{if(mounted.current){setBlocked(true);setRecovery('storage');}}try{await reload();}catch{if(mounted.current)setLoadFailed(true);}})();return()=>{mounted.current=false;};},[workspaceId,userId,job.jobId]);
 useEffect(()=>{const target=focusNext.current;if(!target)return;const element=target==='confirm'?confirmRef.current:target==='recovery'?recoveryRef.current:feedbackRef.current;if(!element)return;focusNext.current=null;element.focus({preventScroll:true});revealIfNeeded(element);});

 const nameOf=(workerId:string)=>workers.find(w=>w.workerId===workerId)?.displayName||'The worker';
 const activeRows=assignments.filter(a=>a.status==='active'),cancelledRows=assignments.filter(a=>a.status==='cancelled');
 const places=(rows:Assignment[])=>`${rows.filter(a=>a.status==='active').length} of ${job.staffingCount} places filled.`;
 const show=(action:Action,tone:'success'|'error',text:string,focus=true)=>{setFeedback({action,tone,text});if(focus)focusNext.current='feedback';};

 const save=async(action:'assign'|'cancel'|'retry')=>{
  if(lock.current||!ready||disabled||blocked)return;
  if(action==='retry'?!pending:!!pending)return;
  lock.current=true;setWorking(action);setFeedback(null);setNeedsHours(null);
  let attempt=action==='retry'?pending:null,sent=false;
  try{
   if(!attempt){
    if(action==='cancel'){if(!cancel)return;attempt={workspaceId,workerId:cancel.workerId,jobId:job.jobId,requestId:crypto.randomUUID(),assignmentId:cancel.assignmentId,status:'cancelled',expectedVersion:cancel.version,expectedWorkerVersion:null,expectedJobVersion:null,expectedPatternVersion:null,expectedStartAt:cancel.startAt,expectedEndAt:cancel.endAt};}
    else{
     if(job.status!=='open'||!selected)throw Error('Choose worker');
     const people=await readWorkers(),worker=people.find(w=>w.workerId===selected);
     if(!worker?.active||!job.requiredSkills.every(s=>worker.skillTags.includes(s)))throw Error('Worker not suitable');
     const pattern=await loadWorkingPattern(workspaceId,selected,async(columns,ws,id)=>{if(!supabaseClient)throw Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_worker_patterns').select(columns).eq('workspace_id',ws).eq('worker_id',id);if(error)throw Error('Unavailable');return data;});
     if(!pattern){if(mounted.current){setNeedsHours(selected);show('assign','error',`${worker.displayName} has no working hours saved. Select “Set working hours”, save their days and hours, then try again.`);}return;}
     attempt={workspaceId,workerId:selected,jobId:job.jobId,requestId:crypto.randomUUID(),assignmentId:null,status:'active',expectedVersion:0,expectedWorkerVersion:worker.version,expectedJobVersion:job.version,expectedPatternVersion:pattern.version,expectedStartAt:job.startAt,expectedEndAt:job.endAt};
    }
    rememberAssignment(window.sessionStorage,userId,attempt);if(mounted.current)setPending(attempt);
   }
   sent=true;
   const saved=await submitAssignmentAttempt(attempt,invokeSave);
   clearAssignment(window.sessionStorage,workspaceId,userId,job.jobId);window.dispatchEvent(new Event('rev-scheduling-changed'));
   if(!mounted.current)return;
   setPending(null);setRecovery(null);setCancel(null);setSelected('');
   const name=nameOf(saved.workerId);let rows:Assignment[]|null=null;
   try{rows=await reload();}catch{rows=null;}
   if(!mounted.current)return;
   if(!rows){setReady(false);setLoadFailed(true);}
   const capacity=rows?places(rows):'Select “Refresh allocation” to see the latest places.';
   show(action,'success',saved.status==='cancelled'?`${name}’s assignment was cancelled. ${capacity} No notification was sent.`:`${name} was assigned. ${capacity} No notification was sent.`);
  }catch(error){
   if(!mounted.current)return;
   if(error instanceof AllocationRefused){
    try{clearAssignment(window.sessionStorage,workspaceId,userId,job.jobId);window.dispatchEvent(new Event('rev-scheduling-changed'));setPending(null);setRecovery(null);setCancel(null);}
    catch{setBlocked(true);setRecovery('storage');focusNext.current='recovery';return;}
    let refreshed=true;try{await reload();}catch{refreshed=false;}
    if(!mounted.current)return;
    if(!refreshed){setReady(false);setLoadFailed(true);}
    show(action,'error',`${error.message} ${refreshed?'The allocation has been refreshed. Review it, then try again.':'Select “Refresh allocation”, then try again.'}`);
   }else if(sent){
    let readable=true;try{restoreAssignment(window.sessionStorage,workspaceId,userId,job.jobId);}catch{readable=false;}
    if(readable){setRecovery(error instanceof AssignmentOutcomeUnknown?error.kind:'server');}else{setBlocked(true);setRecovery('storage');}
    focusNext.current='recovery';
   }else{
    show(action,'error',action==='cancel'?'The cancellation could not be started. Nothing was sent. Try again.':'Choose an active worker with the required skills and saved working hours. Select “Refresh allocation” if their details changed.');
   }
  }finally{lock.current=false;if(mounted.current)setWorking(null);}
 };
 const refresh=()=>{if(lock.current||working)return;setWorking('refresh');setFeedback(null);void reload().then(rows=>{if(mounted.current)show('refresh','success',`Allocation refreshed. ${places(rows)}`,false);}).catch(()=>{if(mounted.current){setReady(false);setLoadFailed(true);show('refresh','error','The allocation could not be refreshed. Check your connection, then select “Refresh allocation” again.');}}).finally(()=>{if(mounted.current)setWorking(null);});};

 const busy=working!==null,controlsDisabled=busy||disabled||blocked||!ready||!!pending,full=activeRows.length>=job.staffingCount;
 const plannerJob=planner?.jobs.find(value=>value.id===job.jobId),guidance=planner&&plannerJob?planner.workers.map(worker=>({worker,...workerSuitability(planner,plannerJob,worker)})):[];
 const suitable=guidance.filter(value=>value.suitable),unavailable=guidance.filter(value=>!value.suitable);
 const candidates=workers.filter(worker=>suitable.some(value=>value.workerId===worker.workerId));
 const selectedCandidate=candidates.some(worker=>worker.workerId===selected);
 const open=job.status==='open';
 const hint=blocked?null:disabled?'Worker changes are paused while this job is being edited or saved. Finish or discard that change first.':!ready?(loadFailed?'Workers could not be loaded. Select “Refresh allocation”.':'Loading workers…'):pending?null:!open?null:full?`${job.staffingCount===1?'The one place is':`All ${job.staffingCount} places are`} filled. Cancel an assignment to free a place.`:plannerJob&&!candidates.length?'No one can be assigned right now. Open “Why can’t I assign someone?” to see the reasons.':null;

 const retryLabel=pending?.status==='cancelled'?'Retry cancellation':'Retry assignment';
 const pendingChange=pending?(pending.status==='cancelled'?`Cancelling ${nameOf(pending.workerId)}’s assignment`:`Assigning ${nameOf(pending.workerId)}`):'This change';
 const recoveryText=recovery==='storage'?'An unfinished worker change for this job could not be read on this device. Do not make further worker changes here; contact support so it can be checked.'
  :recovery==='transport'?`${pendingChange} could not reach Revive, so it is not confirmed. Check your connection, then select “${retryLabel}”.`
  :recovery==='malformed'?`Revive replied, but the reply could not be checked, so ${pendingChange.charAt(0).toLowerCase()+pendingChange.slice(1)} is not confirmed. Select “${retryLabel}” to send the same change again.`
  :recovery==='server'?`Revive could not confirm ${pendingChange.charAt(0).toLowerCase()+pendingChange.slice(1)}. Select “${retryLabel}” to send the same change again.`
  :recovery==='restored'?`${pendingChange} was not confirmed. Select “${retryLabel}” to send the same change again.`:null;
 const feedbackFor=(action:Action)=>feedback?.action===action?<p ref={feedbackRef} tabIndex={-1} role={feedback.tone==='error'?'alert':'status'} className={`mt-2 text-sm ${feedback.tone==='error'?'text-red-700':'text-green-800'}`}>{feedback.text}</p>:null;

 return <article aria-label={`${job.title} job`}>
  <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-lg">{job.title}</h3><span className="text-sm font-medium rounded-full border border-neutral-300 px-3 py-0.5">{open?`${ready?activeRows.length:'–'} of ${job.staffingCount} assigned`:'Job cancelled'}</span></div>
  {when&&<p className="text-sm text-neutral-700 mt-1">{when}</p>}<p className="text-sm text-neutral-700">{job.location}</p>{note}
  <section aria-labelledby={`${ids}-workers`} className="mt-4 border-t border-neutral-200 pt-4">
   <h4 id={`${ids}-workers`} className="font-medium">Workers</h4>
   {recoveryText&&<div ref={recoveryRef} tabIndex={-1} role="alert" className="my-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm"><p className="font-medium">Change not confirmed</p><p className="mt-1">{recoveryText}</p>{pending&&!blocked&&<button className="btn-primary mt-2" aria-busy={working==='retry'} disabled={busy||disabled||blocked||!ready} onClick={()=>void save('retry')}>{working==='retry'?workingLabels.retry:retryLabel}</button>}</div>}
   {feedbackFor('retry')}
   {ready?activeRows.length?<ul className="my-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200">{activeRows.map(a=><li key={a.assignmentId} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span>{nameOf(a.workerId)}</span>{open&&<button className="btn-secondary" aria-describedby={hint?`${ids}-hint`:undefined} disabled={controlsDisabled||!!cancel} onClick={()=>{setFeedback(null);setCancel(a);focusNext.current='confirm';}}>Cancel assignment</button>}</div>
    {cancel?.assignmentId===a.assignmentId&&<div role="group" aria-label="Confirm assignment cancellation" className="mt-3 rounded-lg border border-neutral-300 bg-neutral-50 p-3"><p className="text-sm">Cancel {nameOf(a.workerId)}’s assignment? The job stays open and the history is kept.</p><div className="mt-2 flex flex-wrap gap-2"><button ref={confirmRef} className="btn-primary" aria-busy={working==='cancel'} disabled={controlsDisabled} onClick={()=>void save('cancel')}>{working==='cancel'?workingLabels.cancel:'Confirm cancellation'}</button><button className="btn-secondary" disabled={controlsDisabled} onClick={()=>setCancel(null)}>Keep assignment</button></div></div>}</li>)}</ul>:<p className="my-2 text-sm">No workers assigned yet.</p>:null}
   {feedbackFor('cancel')}
   {open&&<div className="mt-3"><label className="block text-sm font-medium" htmlFor={`${ids}-worker`}>Choose a worker</label><div className="mt-1 flex flex-wrap gap-2"><select id={`${ids}-worker`} className="input-field sm:w-auto sm:flex-1" aria-describedby={hint?`${ids}-hint`:undefined} value={selectedCandidate?selected:''} disabled={controlsDisabled||!!cancel||full} onChange={e=>setSelected(e.target.value)}><option value="">Choose worker</option>{candidates.map(w=><option key={w.workerId} value={w.workerId}>{w.displayName}</option>)}</select><button className="btn-primary" aria-busy={working==='assign'} aria-describedby={hint?`${ids}-hint`:undefined} disabled={controlsDisabled||!!cancel||!selectedCandidate||full} onClick={()=>void save('assign')}>{working==='assign'?workingLabels.assign:'Assign worker'}</button></div>
    {feedbackFor('assign')}
    {needsHours&&<button className="btn-secondary mt-2" onClick={()=>{const card=document.getElementById(`scheduling-worker-${needsHours}`);const details=card?.querySelector('details');if(details)details.open=true;card?.scrollIntoView({behavior:'smooth',block:'start'});}}>Set working hours</button>}</div>}
   {hint&&<p id={`${ids}-hint`} className="mt-2 text-sm text-neutral-700">{hint}</p>}
   {open&&ready&&!plannerJob&&<p className="mt-2 text-sm" role="status">Availability could not be checked. Refresh the allocation and review each worker's working hours before assigning.</p>}
   <div className="mt-3"><button className="btn-secondary" aria-busy={working==='refresh'} disabled={busy||disabled} onClick={refresh}>{working==='refresh'?workingLabels.refresh:'Refresh allocation'}</button>{feedbackFor('refresh')}</div>
   {open&&ready&&plannerJob&&<details className="mt-3 rounded-lg border border-neutral-200 p-3 text-sm"><summary className="cursor-pointer font-medium">Why can’t I assign someone?</summary><div aria-label="Worker suitability guidance" className="mt-2"><p>Required skills: {job.requiredSkills.join(', ')||'None'}</p><p className="font-medium mt-2">Appears suitable</p>{suitable.length?<ul className="list-disc pl-5">{suitable.map(value=><li key={value.workerId}>{value.worker.name}</li>)}</ul>:<p>None currently.</p>}<p className="font-medium mt-2">Cannot currently be assigned</p>{unavailable.length?<ul className="list-disc pl-5">{unavailable.map(value=><li key={value.workerId}><span className="font-medium">{value.worker.name}:</span> {value.message}</li>)}</ul>:<p>None.</p>}<p className="text-xs mt-2">Guidance only. Revive checks again when you assign.</p></div></details>}
   {cancelledRows.length>0&&<details className="mt-3 rounded-lg border border-neutral-200 p-3 text-sm"><summary className="cursor-pointer font-medium">View assignment history</summary><ul className="mt-2 list-disc pl-5">{cancelledRows.map(a=><li key={a.assignmentId}>{nameOf(a.workerId)} – cancelled</li>)}</ul></details>}
  </section>
  {jobActions&&<section aria-label="Job actions" className="mt-4 border-t border-neutral-200 pt-4"><div className="flex flex-wrap gap-2">{jobActions}</div></section>}
 </article>;
}
