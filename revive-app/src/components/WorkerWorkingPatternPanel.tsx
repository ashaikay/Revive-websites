import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadWorkingPattern,submitPatternAttempt,rememberPatternAttempt,restorePatternAttempt,clearPatternAttempt,type PatternAttempt,type WorkingPattern} from '@/services/workerWorkingPatterns';
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
interface Draft {timezone:string;workingDays:number[];startLocal:string;endLocal:string;effectiveFrom:string;effectiveUntil:string;version:number;}
const blank=():Draft=>({timezone:'Europe/London',workingDays:[],startLocal:'',endLocal:'',effectiveFrom:'',effectiveUntil:'',version:0});
const draftFrom=(p:WorkingPattern):Draft=>({...p,effectiveUntil:p.effectiveUntil??''});
export function WorkerWorkingPatternPanel({workspaceId,userId,workerId,active,disabled=false}:{workspaceId:string;userId:string;workerId:string;active:boolean;disabled?:boolean}){
 const [draft,setDraft]=useState<Draft>(blank),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<PatternAttempt|null>(null),[blocked,setBlocked]=useState(false);
 const lock=useRef(false),mounted=useRef(true);
 const read=()=>loadWorkingPattern(workspaceId,workerId,async(columns,ws,worker)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_worker_patterns').select(columns).eq('workspace_id',ws).eq('worker_id',worker);if(error)throw new Error('Unavailable');return data;});
 useEffect(()=>{mounted.current=true;void(async()=>{try{const saved=restorePatternAttempt(window.sessionStorage,workspaceId,userId,workerId);if(saved&&mounted.current){setPending(saved);setMessage('A working-pattern save is unconfirmed. Retry the same request before editing.');}}catch{if(mounted.current){setBlocked(true);setMessage('Pending request could not be read. Contact support before changing this pattern.');}}try{const saved=await read();if(mounted.current){setDraft(saved?draftFrom(saved):blank());setReady(true);}}catch{if(mounted.current)setMessage('Working pattern could not be loaded. Refresh to try again.');}})();return()=>{mounted.current=false;};},[workspaceId,userId,workerId]);
 const save=async()=>{
  if(lock.current||!ready||!active||disabled||blocked)return;lock.current=true;setBusy(true);setMessage('');let attempt=pending;
  try{
   if(!attempt){attempt={workspaceId,workerId,requestId:crypto.randomUUID(),timezone:draft.timezone,workingDays:draft.workingDays,startLocal:draft.startLocal,endLocal:draft.endLocal,effectiveFrom:draft.effectiveFrom,effectiveUntil:draft.effectiveUntil||null,expectedVersion:draft.version};rememberPatternAttempt(window.sessionStorage,userId,attempt);if(mounted.current)setPending(attempt);}
   const saved=await submitPatternAttempt(attempt,async(name,body)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.functions.invoke(name,{body});if(error)throw new Error('Unavailable');return data;});clearPatternAttempt(window.sessionStorage,workspaceId,userId,workerId);window.dispatchEvent(new Event('rev-scheduling-changed'));
   if(mounted.current){setPending(null);setDraft(draftFrom(saved));setMessage('Working pattern saved.');}
  }catch{if(mounted.current){let remembered=false;try{remembered=restorePatternAttempt(window.sessionStorage,workspaceId,userId,workerId)!==null;}catch{setBlocked(true);remembered=true;}setMessage(remembered?'Save could not be confirmed. Retry the same request; do not create another attempt.':'Select working days, valid hours, timezone and effective dates.');}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 return <details className="border-t mt-4 pt-3"><summary className="cursor-pointer font-medium">Working availability</summary>{message&&<p role="status" className="my-2">{message}</p>}{!active&&<p className="text-sm my-2">This worker is inactive. Their saved pattern is retained.</p>}{ready&&<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy||!!pending||!active||disabled||blocked}>
 <label className="block my-2">Timezone<input className="block border rounded p-2 w-full" required value={draft.timezone} onChange={event=>setDraft({...draft,timezone:event.target.value})}/></label>
 <fieldset><legend>Working days</legend>{days.map((day,index)=><label key={day} className="inline-flex gap-1 mr-3 my-2"><input type="checkbox" checked={draft.workingDays.includes(index+1)} onChange={event=>setDraft({...draft,workingDays:event.target.checked?[...draft.workingDays,index+1]:draft.workingDays.filter(d=>d!==index+1)})}/>{day}</label>)}</fieldset>
 <label className="block my-2">Start time<input className="block border rounded p-2" required type="time" value={draft.startLocal} onChange={event=>setDraft({...draft,startLocal:event.target.value})}/></label>
 <label className="block my-2">End time<input className="block border rounded p-2" required type="time" value={draft.endLocal} onChange={event=>setDraft({...draft,endLocal:event.target.value})}/></label>
 <label className="block my-2">Effective from<input className="block border rounded p-2" required type="date" min="1000-01-01" max="9999-12-31" value={draft.effectiveFrom} onChange={event=>setDraft({...draft,effectiveFrom:event.target.value})}/></label>
 <label className="block my-2">Effective until (optional, inclusive)<input className="block border rounded p-2" type="date" min={draft.effectiveFrom||'1000-01-01'} max="9999-12-31" value={draft.effectiveUntil} onChange={event=>setDraft({...draft,effectiveUntil:event.target.value})}/></label>
 <p className="text-sm my-2">One regular working pattern per worker. Start and end times must fall on the same day. Leave and shift allocation will follow.</p><button type="submit" className="btn-secondary">SAVE WORKING PATTERN</button>
 </fieldset></form>}{pending&&<button type="button" className="btn-secondary mt-3" disabled={busy||!active||disabled||blocked||!ready} onClick={()=>void save()}>RETRY SAME PATTERN SAVE</button>}</details>;
}
