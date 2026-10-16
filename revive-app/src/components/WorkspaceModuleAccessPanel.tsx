import { useEffect, useRef, useState } from 'react';
import { loadModuleAccess, saveModuleAccess, parseModuleAttempt, ModuleAccessRejected, moduleLabels, revModules, type ModuleAccess, type ModuleAttempt, type RevModule } from '@/services/workspaceModuleAccess';
import type { TeamMember } from '@/services/workspaceTeam';
export function WorkspaceModuleAccessPanel({workspaceId,actorId,members,onLocked,externalLocked=false}: {workspaceId:string;actorId:string;members:TeamMember[];onLocked:(value:boolean)=>void;externalLocked?:boolean}) {
 const key=`rev-module-attempt:${workspaceId}:${actorId}`;
 const [selected,setSelected]=useState(''),[access,setAccess]=useState<ModuleAccess|null>(null),[modules,setModules]=useState<RevModule[]>([]);
 const [pending,setPending]=useState<ModuleAttempt|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),inFlight=useRef(false); const identity=useRef(key);identity.current=key;
 const ownLocked=busy || !!pending || blocked;
 const locked=ownLocked || externalLocked;
 useEffect(()=>{onLocked(ownLocked);},[ownLocked,onLocked]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onLocked(false);};},[onLocked]);
 useEffect(()=>{
  setPending(null);setSelected('');setAccess(null);setBlocked(false);setMessage('');setError('');
  try {const raw=sessionStorage.getItem(key);if(raw){const attempt=parseModuleAttempt(JSON.parse(raw),workspaceId);setSelected(attempt.userId);setModules(attempt.modules);setPending(attempt);}}
  catch {setBlocked(true);setError('A retained access change could not be read. Contact your organisation owner.');}
 },[key,workspaceId]);
 useEffect(()=>{let current=true;setAccess(null);if(!selected || pending || blocked)return;
  void loadModuleAccess(workspaceId,selected).then(value=>{if(current){setAccess(value);setModules(value.modules);}}).catch(()=>{if(current)setError('Access could not be loaded. Try Reload access.');});
  return()=>{current=false;};
 },[workspaceId,selected,pending,blocked,refresh]);
 const save=async(attempt:ModuleAttempt)=>{
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage('');setError('');const context=identity.current;
  try {
   sessionStorage.setItem(key,JSON.stringify(attempt));setPending(attempt);
   const value=await saveModuleAccess(attempt);if(!alive.current || context!==identity.current)return;
   sessionStorage.removeItem(key);setPending(null);setAccess(value);setMessage('Section access saved.');
  } catch(failure) {
   if(!alive.current || context!==identity.current)return;
   if(failure instanceof ModuleAccessRejected){sessionStorage.removeItem(key);setPending(null);setAccess(null);setError(failure.message);}
   else setError('Save not confirmed. Retry the same access change.');
  } finally {inFlight.current=false;if(alive.current && context===identity.current)setBusy(false);}
 };
 return <section className="mt-5 rounded border p-4" aria-label="Staff section access"><h4 className="font-semibold">Section access</h4><p className="mt-1 text-sm">New staff start with Outcomes only. Programme registration and caseload assignment are still required.</p>
 <label className="mt-3 block text-sm">Staff member<select className="mt-1 rounded border p-2" value={selected} disabled={locked} onChange={e=>{setSelected(e.target.value);setMessage('');setError('');}}><option value="">Choose staff member</option>{members.filter(m=>['member','viewer'].includes(m.role)&&['active','suspended'].includes(m.status)).map(m=><option key={m.userId} value={m.userId}>{m.displayName??`Account ending ${m.userId.slice(-6)}`}</option>)}</select></label>
 {error&&<p className="mt-2 text-sm" role="alert">{error}</p>}{message&&<p className="mt-2 text-sm" role="status">{message}</p>}
 {busy&&<p role="status">Saving access...</p>}
 {pending&&!busy&&<button className="btn-primary mt-3" onClick={()=>void save(pending)}>Retry same access change</button>}
 {!pending&&selected&&<><button className="btn-secondary mt-2" disabled={locked} onClick={()=>{setError('');setRefresh(v=>v+1);}}>Reload access</button>{access&&!access.managed&&<form onSubmit={e=>{e.preventDefault();if(!locked)void save({workspaceId,userId:selected,modules:revModules.filter(m=>modules.includes(m)),expectedVersion:access.version,requestId:crypto.randomUUID()});}}><fieldset className="mt-3 flex flex-wrap gap-3" disabled={locked}><legend className="mb-2 text-sm">Allowed sections</legend>{revModules.map(m=><label key={m} className="text-sm"><input type="checkbox" checked={modules.includes(m)} onChange={e=>setModules(old=>e.target.checked?[...old,m]:old.filter(x=>x!==m))}/> {moduleLabels[m]}</label>)}</fieldset><p className="mt-2 text-sm">Existing role limits still apply. Unticking every section removes module access without deleting records.</p><button className="btn-primary mt-3" disabled={locked}>Save section access</button></form>}</>}
 </section>;
}
