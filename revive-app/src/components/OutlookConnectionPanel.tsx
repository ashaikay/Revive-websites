import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { calendarOAuthReturn, startCalendarOAuth, completeCalendarOAuth, type OAuthInvoke } from '@/services/calendarOAuthBrowser';
const invoke: OAuthInvoke = async (name, body) => {
  if (!supabaseClient) throw new Error('Calendar service unavailable');
  const {data,error} = await supabaseClient.functions.invoke(name,{body});
  if(error)throw new Error('Calendar authorization unavailable');return data;
};
export function OutlookConnectionPanel({workspaceId,userId,callback=false}:{workspaceId:string;userId:string;callback?:boolean}) {
  const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false);
  const locked=useRef(false);
  const enabled=import.meta.env.VITE_REV_CALENDAR_OAUTH_UI_ENABLED==='true';
  useEffect(()=>{
    let mounted=true;setAllowed(false);
    if(!enabled||!supabaseClient||callback)return;
    void supabaseClient.from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle().then(({data,error})=>{if(mounted)setAllowed(!error&&data?.status==='active'&&['owner','admin'].includes(data.role));});
    return()=>{mounted=false;};
  },[workspaceId,userId,enabled,callback]);
  if(!enabled)return callback?<div className="card p-6">Outlook connection setup is unavailable. <a href="/#rev">Return to REV</a></div>:null;
  if(!callback&&!allowed)return null;
  const execute=async()=>{
    if(locked.current||done)return;locked.current=true;setBusy(true);setMessage('');
    try{
      if(callback){if(!calendarOAuthReturn)throw new Error('Missing callback');await completeCalendarOAuth(calendarOAuthReturn,userId,window.sessionStorage,invoke);setDone(true);setMessage('Outlook authorization saved. Calendar discovery is the next step; no calendar has been activated.');}
      else{const url=await startCalendarOAuth(workspaceId,userId,window.sessionStorage,invoke);window.location.assign(url);}
    }catch{setMessage(callback?'Authorization could not be completed. Return to REV and start a new connection attempt.':'Outlook connection could not be started. Please try again.');if(callback)setDone(true);}
    finally{setBusy(false);locked.current=false;}
  };
  return <section className="max-w-4xl mx-auto card p-6 my-6"><h2 className="text-lg font-semibold">{callback?'Complete Outlook authorization':'Outlook calendar connection'}</h2><p className="text-sm text-neutral-600 my-3">Connect calendar read access. This does not enable bookings or send invitations.</p>{message&&<p role="status" className="my-3">{message}</p>}{!done&&<button className="btn-secondary" disabled={busy} onClick={()=>void execute()}>{busy?'Please wait...':callback?'SAVE OUTLOOK AUTHORIZATION':'CONNECT OUTLOOK'}</button>}{callback&&<a className="block mt-4" href="/#rev">Return to REV</a>}</section>;
}
