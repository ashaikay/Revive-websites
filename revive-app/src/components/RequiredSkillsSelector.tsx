import {useEffect,useRef,useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {loadSchedulingWorkers,type Worker} from '@/services/schedulingWorkers';
import {skillKey} from '@/services/skillMatching';
import type {SkillRequirementMode} from '@/services/skillMatching';

export interface SkillOption{label:string;key:string;held:boolean;}

const byLabel=(a:string,b:string)=>a.localeCompare(b,'en-GB',{sensitivity:'base'})||(a<b?-1:a>b?1:0);

// One checkbox per saved worker skill (case/spacing variants merged by skillKey), plus every label
// already chosen or saved on the job, exactly as written, so nothing is ever dropped silently.
export function skillOptions(workers:readonly Worker[],selected:readonly string[],existing:readonly string[]):SkillOption[]{
 const counts=new Map<string,Map<string,number>>();
 for(const worker of workers)if(worker.active)for(const tag of new Set(worker.skillTags)){const key=skillKey(tag);if(!key)continue;const labels=counts.get(key)??new Map<string,number>();labels.set(tag,(labels.get(tag)??0)+1);counts.set(key,labels);}
 const options:SkillOption[]=[],seenLabels=new Set<string>(),coveredKeys=new Set<string>();
 for(const label of [...existing,...selected]){if(seenLabels.has(label))continue;seenLabels.add(label);const key=skillKey(label);coveredKeys.add(key);options.push({label,key,held:counts.has(key)});}
 for(const [key,labels] of counts){if(coveredKeys.has(key))continue;const label=[...labels].sort((a,b)=>b[1]-a[1]||byLabel(a[0],b[0]))[0][0];options.push({label,key,held:true});}
 return options.sort((a,b)=>byLabel(a.label,b.label));
}

export function RequiredSkillsSelector({workspaceId,selected,existing,mode,onChange}:{workspaceId:string;selected:string[];existing:string[];mode:SkillRequirementMode;onChange:(skills:string[])=>void}){
 const [workers,setWorkers]=useState<Worker[]>([]),[state,setState]=useState<'loading'|'ready'|'failed'>('loading');
 const seq=useRef(0);
 useEffect(()=>{
  let live=true;
  const read=async()=>{const token=++seq.current;try{const list=await loadSchedulingWorkers(workspaceId,async(columns,ws)=>{if(!supabaseClient)throw Error('Unavailable');const {data,error}=await supabaseClient.from('scheduling_workers').select(columns).eq('workspace_id',ws);if(error)throw Error('Unavailable');return data;});if(live&&token===seq.current){setWorkers(list);setState('ready');}}catch{if(live&&token===seq.current)setState('failed');}};
  void read();const onWorkersChanged=()=>{void read();};window.addEventListener('rev-scheduling-changed',onWorkersChanged);
  return()=>{live=false;window.removeEventListener('rev-scheduling-changed',onWorkersChanged);};
 },[workspaceId]);
 const options=skillOptions(workers,selected,existing);
 const toggle=(label:string,on:boolean)=>onChange(on?[...selected,label]:selected.filter(value=>value!==label));
 return <fieldset className="my-3 rounded-lg border border-neutral-300 p-3" aria-describedby="required-skills-help">
  <legend className="px-1 text-sm font-medium">Required skills</legend>
  <p id="required-skills-help" className="text-sm text-neutral-700">Choose the skills needed. {mode==='all'?'Workers must have every selected skill.':'Workers must have at least one selected skill.'}</p>
  {state==='loading'&&<p role="status" className="mt-2 text-sm text-neutral-600">Loading saved worker skills…</p>}
  {state==='failed'&&<p role="alert" className="mt-2 text-sm text-red-800">Saved worker skills could not be loaded. Skills already on this job are kept. Close and reopen the form to try again.</p>}
  {state==='ready'&&options.length===0&&<p className="mt-2 text-sm text-neutral-600">No worker skills saved yet. Add skills to a worker first.</p>}
  {options.length>0&&<ul className="mt-2 grid gap-2 sm:grid-cols-2">{options.map(option=><li key={option.label}><label className="flex items-start gap-2 rounded border border-neutral-200 p-2"><input type="checkbox" className="mt-1" checked={selected.includes(option.label)} onChange={event=>toggle(option.label,event.target.checked)}/><span>{option.label}{!option.held&&state==='ready'&&<span className="block text-xs text-amber-800">No current worker has this skill</span>}</span></label></li>)}</ul>}
  {selected.length===0&&<p className="mt-2 text-sm text-neutral-700">No specific skills required.</p>}
 </fieldset>;
}
