import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { calendarOAuthReturn, startCalendarOAuth, completeCalendarOAuth, type OAuthInvoke } from '@/services/calendarOAuthBrowser';
import { loadCalendarConnectionMetadata, requestCalendarDiscovery, requestCalendarSelection, requestCalendarDisconnect } from '@/services/calendarConnectionMetadata';
const invoke: OAuthInvoke = async (name, body) => {
  if (!supabaseClient) throw new Error('Calendar service unavailable');
  const {data,error} = await supabaseClient.functions.invoke(name,{body});
  if(error)throw new Error('Calendar authorization unavailable');return data;
};
type Metadata = Awaited<ReturnType<typeof loadCalendarConnectionMetadata>>;
async function loadMetadata(workspaceId:string):Promise<Metadata>{
  return loadCalendarConnectionMetadata(workspaceId,async(table,columns,workspace)=>{
    if(!supabaseClient)throw new Error('Calendar service unavailable');
    const{data,error}=await supabaseClient.from(table).select(columns).eq('workspace_id',workspace);
    if(error)throw new Error('Calendar metadata unavailable');return data;
  });
}
export function OutlookConnectionPanel({workspaceId,userId,callback=false}:{workspaceId:string;userId:string;callback?:boolean}) {
  const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false);
  const [metadata,setMetadata]=useState<Metadata>({connections:[],calendars:[]});
  const [timezone,setTimezone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London');
  const [disconnectConfirmation,setDisconnectConfirmation]=useState<string|null>(null);
  const locked=useRef(false);
  const enabled=import.meta.env.VITE_REV_CALENDAR_OAUTH_UI_ENABLED==='true';
  useEffect(()=>{
    let mounted=true;setDisconnectConfirmation(null);setAllowed(false);setMetadata({connections:[],calendars:[]});
    const client=supabaseClient;
    if(!enabled||!client||callback)return;
    void (async()=>{
      const{data,error}=await client.from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
      if(!mounted)return;
      const permitted=!error&&data?.status==='active'&&['owner','admin'].includes(data.role);setAllowed(permitted);
      if(permitted){try{const loaded=await loadMetadata(workspaceId);if(mounted)setMetadata(loaded);}catch{if(mounted)setMessage('Calendar connections could not be loaded. Refresh to try again.');}}
    })();
    return()=>{mounted=false;};
  },[workspaceId,userId,enabled,callback]);
  if(!enabled)return callback?<div className="card p-6">Outlook connection setup is unavailable. <a href="/#rev">Return to REV</a></div>:null;
  if(!callback&&!allowed)return null;
  const execute=async()=>{
    if(locked.current||done)return;locked.current=true;setBusy(true);setMessage('');
    try{
      if(callback){if(!calendarOAuthReturn)throw new Error('Missing callback');await completeCalendarOAuth(calendarOAuthReturn,userId,window.sessionStorage,invoke);setDone(true);setMessage('Outlook authorization saved. Return to REV and discover calendars to finish setting up read access.');}
      else{const url=await startCalendarOAuth(workspaceId,userId,window.sessionStorage,invoke);window.location.assign(url);}
    }catch{setMessage(callback?'Authorization could not be completed. Return to REV and start a new connection attempt.':'Outlook connection could not be started. Please try again.');if(callback)setDone(true);}
    finally{setBusy(false);locked.current=false;}
  };
  const discover=async(connectionId:string)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setMessage('');
    try{
      const count=await requestCalendarDiscovery(workspaceId,connectionId,timezone,invoke);
      setMessage(`${count} calendar${count===1?'':'s'} discovered. No calendar is selected and bookings remain disabled.`);
      try{setMetadata(await loadMetadata(workspaceId));}catch{setMessage('Calendar discovery was saved. Refresh to reload the calendar list.');}
    }catch{
      // Reload durable state even after an uncertain response. Never automatically retry discovery.
      try{setMetadata(await loadMetadata(workspaceId));}catch{/* Keep the last known list. */}
      setMessage('Discovery could not be confirmed. Check the refreshed connection status before trying again. If it is disconnected, Outlook authorization may need to be restarted.');
    }finally{setBusy(false);locked.current=false;}
  };
  const selectCalendar=async(calendarId:string,connectionId:string)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setMessage('');
    try{
      await requestCalendarSelection(workspaceId,calendarId,connectionId,invoke);
      try{setMetadata(await loadMetadata(workspaceId));setMessage('Calendar selection saved. Booking remains disabled.');}
      catch{setMessage('Calendar selection saved. Refresh to reload the selected calendar.');}
    }catch{
      try{setMetadata(await loadMetadata(workspaceId));}catch{/* Keep the last known list. */}
      setMessage('Calendar selection could not be confirmed. Check the refreshed selection before trying again.');
    }finally{setBusy(false);locked.current=false;}
  };
  const disconnect=async(connectionId:string)=>{
    if(locked.current||disconnectConfirmation!==connectionId)return;
    locked.current=true;setBusy(true);setMessage('');
    try{
      await requestCalendarDisconnect(workspaceId,connectionId,invoke);
      // A validated durable response is sufficient to hide stale execution/discovery controls.
      setMetadata(previous=>({connections:previous.connections.map(c=>c.id===connectionId?{...c,status:'revoked'}:c),calendars:previous.calendars.map(c=>c.connectionId===connectionId?{...c,active:false,selected:false}:c)}));
      setDisconnectConfirmation(null);
      try{
        const loaded=await loadMetadata(workspaceId);
        if(loaded.connections.find(c=>c.id===connectionId)?.status!=='revoked'||loaded.calendars.some(c=>c.connectionId===connectionId&&(c.active||c.selected)))throw new Error('Stale metadata');
        setMetadata(loaded);setMessage('Outlook disconnected from REV. Stored access was removed. Existing calendar events are unchanged.');
      }catch{setMessage('Outlook disconnected from REV. Refresh to confirm the saved connection status.');}
    }catch{
      try{setMetadata(await loadMetadata(workspaceId));}catch{/* No automatic retry. */}
      setDisconnectConfirmation(null);
      setMessage('Disconnect could not be confirmed. Check the connection status before trying again.');
    }finally{setBusy(false);locked.current=false;}
  };
  return <section className="max-w-4xl mx-auto card p-6 my-6">
    <h2 className="text-lg font-semibold">{callback?'Complete Outlook authorization':'Outlook calendar connection'}</h2>
    <p className="text-sm text-neutral-600 my-3">Connect calendar read access. This does not enable bookings or send invitations.</p>
    {message&&<p role="status" className="my-3">{message}</p>}
    {!done&&<button className="btn-secondary" disabled={busy||disconnectConfirmation!==null} onClick={()=>void execute()}>{busy?'Please wait...':callback?'SAVE OUTLOOK AUTHORIZATION':'CONNECT OUTLOOK'}</button>}
    {callback?<a className="block mt-4" href="/#rev">Return to REV</a>:<>
      <label className="block text-sm mt-4">Calendar timezone<input className="block border rounded px-3 py-2 mt-1" value={timezone} disabled={busy} onChange={event=>setTimezone(event.target.value)} placeholder="Europe/London" /></label>
      {metadata.connections.length===0&&<p className="text-sm mt-4">No Outlook connections saved.</p>}
      {metadata.connections.map(connection=><div key={connection.id} className="border rounded p-4 mt-4">
        <p className="font-medium">{connection.account||'Outlook connection'}</p><p className="text-sm">Status: {connection.status}</p>
        {connection.status==='disconnected'&&connection.authorizedBy===userId&&<><p className="text-sm my-2">After saving Outlook authorization, discover its calendars here.</p><button className="btn-secondary" disabled={busy||disconnectConfirmation!==null} onClick={()=>void discover(connection.id)}>DISCOVER CALENDARS</button></>}
        {connection.status!=='revoked'&&(disconnectConfirmation===connection.id?<div className="my-3" role="group" aria-label="Confirm Outlook disconnect">
          <p className="text-sm mb-2">Disconnect this Outlook connection from REV? Its stored access will be removed and calendar selection cleared. Existing events are unchanged. Microsoft consent can be removed separately in your Microsoft account.</p>
          <button className="btn-secondary" disabled={busy} onClick={()=>void disconnect(connection.id)}>CONFIRM DISCONNECT</button>
          <button className="btn-secondary ml-3" disabled={busy} onClick={()=>setDisconnectConfirmation(null)}>CANCEL</button>
        </div>:<button className="btn-secondary mt-3" disabled={busy} onClick={()=>setDisconnectConfirmation(connection.id)}>DISCONNECT OUTLOOK</button>)}
        <ul className="mt-3 space-y-2">{metadata.calendars.filter(calendar=>calendar.connectionId===connection.id&&calendar.active).map(calendar=><li key={calendar.id}>{calendar.displayName} <span className="text-sm text-neutral-600">({calendar.timezone}) · {calendar.selected?'Selected':'Not selected'}</span>{connection.status==='connected'&&!calendar.selected&&<button className="btn-secondary ml-3" disabled={busy||disconnectConfirmation!==null} onClick={()=>void selectCalendar(calendar.id,connection.id)}>SELECT CALENDAR</button>}</li>)}</ul>
      </div>)}
    </>}
  </section>;
}
