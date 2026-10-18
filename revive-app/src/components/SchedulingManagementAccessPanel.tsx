import {useEffect,useRef,useState} from 'react';
import {loadSchedulingManagement,saveSchedulingManagement,parseSchedulingPermissionAttempt,SchedulingPermissionRejected,type SchedulingManagement,type SchedulingPermissionAttempt} from '@/services/schedulingManagementAccess';
import type {TeamMember} from '@/services/workspaceTeam';
export function SchedulingManagementAccessPanel({workspaceId,actorId,members,externalLocked,onLocked}:{workspaceId:string;actorId:string;members:TeamMember[];externalLocked:boolean;onLocked:(locked:boolean)=>void}) {
 const key=`rev-scheduling-permission:${workspaceId}:${actorId}`;
 const [selected,setSelected]=useState(''),[access,setAccess]=useState<SchedulingManagement|null>(null),[enabled,setEnabled]=useState(false),[pending,setPending]=useState<SchedulingPermissionAttempt|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[refresh,setRefresh]=useState(0);
 const inFlight=useRef(false),identity=useRef(key),alive=useRef(true);identity.current=key;
 const ownLocked=busy||!!pending||blocked,locked=ownLocked||externalLocked;
 useEffect(()=>{onLocked(ownLocked);},[ownLocked,onLocked]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onLocked(false);};},[onLocked]);
 useEffect(()=>{setSelected('');setPending(null);setAccess(null);setBlocked(false);setMessage('');try{const raw=sessionStorage.getItem(key);if(raw){const attempt=parseSchedulingPermissionAttempt(JSON.parse(raw),workspaceId);setPending(attempt);setSelected(attempt.userId);setEnabled(attempt.enabled);setMessage('Save not confirmed. Retry the same permission change.');}}catch{setBlocked(true);setMessage('A retained permission change could not be read. Contact your organisation owner.');}},[key,workspaceId]);
 useEffect(()=>{let current=true;setAccess(null);if(!selected||pending||blocked)return;void loadSchedulingManagement(workspaceId,selected).then(value=>{if(current){setAccess(value);setEnabled(value.enabled);}}).catch(()=>{if(current)setMessage('Permission could not be loaded. Try Reload Scheduling permission.');});return()=>{current=false;};},[workspaceId,selected,pending,blocked,refresh]);
 const save=async(attempt:SchedulingPermissionAttempt)=>{
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage('Saving permission...');const context=identity.current;
  try{sessionStorage.setItem(key,JSON.stringify(attempt));setPending(attempt);const value=await saveSchedulingManagement(attempt);if(!alive.current||context!==identity.current)return;sessionStorage.removeItem(key);setPending(null);setAccess(value);setMessage('Scheduling permission saved.');}
  catch(error){if(!alive.current||context!==identity.current)return;if(error instanceof SchedulingPermissionRejected){try{sessionStorage.removeItem(key);setPending(null);setAccess(null);}catch{setBlocked(true);}setMessage(error.message);}else setMessage('Save not confirmed. Retry the same permission change.');}
  finally{inFlight.current=false;if(alive.current&&context===identity.current)setBusy(false);}
 };
 return <section className="mt-5 rounded border p-4" aria-label="Scheduling management permission"><h4 className="font-semibold">Scheduling manager</h4><p className="mt-2">Allow a staff member to manage workers, working hours, jobs and assignments. Scheduling section access must also be enabled.</p>
 <label className="mt-3 block">Scheduling staff member<select className="mt-1 rounded border p-2" disabled={locked} value={selected} onChange={e=>{setSelected(e.target.value);setMessage('');}}><option value="">Choose staff member</option>{members.filter(m=>m.role==='member'&&['active','suspended'].includes(m.status)).map(m=><option key={m.userId} value={m.userId}>{m.displayName??`Account ending ${m.userId.slice(-6)}`}</option>)}</select></label>
 {message&&<p className="mt-2" role="status">{message}</p>}
 {pending&&!busy&&<button type="button" className="btn-primary mt-3" disabled={externalLocked||blocked} onClick={()=>void save(pending)}>Retry same Scheduling permission</button>}
 {!pending&&selected&&<><button type="button" className="btn-secondary mt-2" disabled={locked} onClick={()=>{setMessage('');setRefresh(v=>v+1);}}>Reload Scheduling permission</button>{access&&!access.managed&&<form onSubmit={e=>{e.preventDefault();if(!locked)void save({workspaceId,userId:selected,enabled,expectedVersion:access.version,requestId:crypto.randomUUID()});}}><label className="mt-3 flex gap-2"><input type="checkbox" checked={enabled} disabled={locked} onChange={e=>setEnabled(e.target.checked)}/>Manage Scheduling</label><p className="mt-2 text-sm">Organisation access, annual leave administration and document analysis remain with owners and admins.</p><button className="btn-primary mt-3" disabled={locked}>{busy?'Saving...':'Save Scheduling permission'}</button></form>}</>}
 </section>;
}
