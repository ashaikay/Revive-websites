import { useEffect, useState, type ReactNode } from 'react';
import { accessPages, loadModuleAccess } from '@/services/workspaceModuleAccess';
export function WorkspaceModuleGate({workspaceId,userId,page,onSignOut,children}: {workspaceId:string;userId:string;page:string;onSignOut:()=>Promise<void>;children:(pages:string[],page:string)=>ReactNode}) {
  const identity=workspaceId+':'+userId;
  const [access,setAccess]=useState<{identity:string;pages:string[]} | null>(null);
  const [failed,setFailed]=useState(false), [reload,setReload]=useState(0);
  useEffect(()=>{
    let current=true, reading=false;
    const read=async()=>{
      if(reading)return; reading=true;
      try { const result=await loadModuleAccess(workspaceId,userId); if(current){setAccess({identity,pages:accessPages(result.modules)});setFailed(false);} }
      catch {if(current){setAccess(null);setFailed(true);}}
      finally {reading=false;}
    };
    setAccess(null);setFailed(false);void read();
    const focus=()=>void read();window.addEventListener('focus',focus);
    const timer=window.setInterval(focus,30000);
    return ()=>{current=false;window.removeEventListener('focus',focus);window.clearInterval(timer);};
  },[workspaceId,userId,identity,reload]);
  const pages=access?.identity===identity?access.pages:null;
  const effective=pages?.includes(page)?page:pages?.[0];
  useEffect(()=>{if(effective && effective!==page)window.location.hash=effective==='home'?'':effective;},[effective,page]);
  if(failed)return <main className="p-6"><p role="alert">Section access could not be loaded.</p><button className="btn-secondary" onClick={()=>setReload(v=>v+1)}>Retry access check</button><button className="btn-secondary ml-2" onClick={()=>void onSignOut()}>Sign out</button></main>;
  if(!pages)return <main className="p-6" role="status">Loading your access...</main>;
  if(!effective)return <main className="p-6"><p>No REV sections are enabled for your account. Contact your organisation manager.</p><button className="btn-secondary mt-3" onClick={()=>void onSignOut()}>Sign out</button></main>;
  return <>{children(pages,effective)}</>;
}
