import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadBusinessHours,saveBusinessHours,type BusinessHoursPolicy} from '@/services/calendarBusinessHours';
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export function CalendarBusinessHoursPanel({workspaceId,disabled=false}:{workspaceId:string;disabled?:boolean}){
 const [policy,setPolicy]=useState<BusinessHoursPolicy|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false);
 const read=async()=>loadBusinessHours(workspaceId,async(columns,workspace)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.from('workspace_calendar_business_hours').select(columns).eq('workspace_id',workspace);if(error)throw new Error('Unavailable');return data;});
 const blank=():BusinessHoursPolicy=>({workspaceId,timezone:'Europe/London',workingDays:[],startLocal:'',endLocal:'',version:0});
 useEffect(()=>{let mounted=true;setReady(false);setPolicy(null);void read().then(saved=>{if(mounted){setPolicy(saved??blank());setReady(true);}}).catch(()=>{if(mounted)setMessage('Business hours could not be loaded. Refresh to try again.');});return()=>{mounted=false;};},[workspaceId]);
 const submit=async()=>{
  if(lock.current||!ready||!policy||disabled)return;lock.current=true;setBusy(true);setMessage('');
  try{const saved=await saveBusinessHours(policy,async(name,body)=>{if(!supabaseClient)throw new Error('Unavailable');const {data,error}=await supabaseClient.functions.invoke(name,{body});if(error)throw new Error('Unavailable');return data;});setPolicy(saved);setMessage('Business hours saved. Availability wiring is not yet enabled for this policy.');}
  catch{setReady(false);try{setPolicy(await read()??blank());setReady(true);setMessage('Save could not be confirmed. The latest saved settings have been loaded. Review them before saving again.');}catch{setMessage('Save could not be confirmed. Refresh to load the saved settings before trying again.');}}
  finally{setBusy(false);lock.current=false;}
 };
 return <section className="border rounded p-4 mt-6"><h3 className="font-semibold">BUSINESS HOURS</h3><p className="text-sm my-2">Set this workspace’s working days and opening hours. This does not enable bookings.</p>{message&&<p role="status">{message}</p>}{ready&&policy&&<form onSubmit={event=>{event.preventDefault();void submit();}}><fieldset disabled={busy||disabled}>
  <label className="block my-3">Business timezone<input className="block border rounded p-2" required value={policy.timezone} onChange={event=>setPolicy({...policy,timezone:event.target.value})}/></label>
  <fieldset><legend>Working days</legend>{days.map((day,index)=><label key={day} className="inline-flex gap-2 mr-4 my-2"><input type="checkbox" checked={policy.workingDays.includes(index+1)} onChange={event=>setPolicy({...policy,workingDays:event.target.checked?[...policy.workingDays,index+1]:policy.workingDays.filter(d=>d!==index+1)})}/>{day}</label>)}</fieldset>
  <label className="block my-3">Opening time<input className="block border rounded p-2" type="time" required value={policy.startLocal} onChange={event=>setPolicy({...policy,startLocal:event.target.value})}/></label>
  <label className="block my-3">Closing time<input className="block border rounded p-2" type="time" required value={policy.endLocal} onChange={event=>setPolicy({...policy,endLocal:event.target.value})}/></label>
  <p className="text-sm my-2">Opening and closing times must fall on the same day.</p><button className="btn-secondary" type="submit">{busy?'Saving...':'SAVE BUSINESS HOURS'}</button>
 </fieldset></form>}</section>;
}
