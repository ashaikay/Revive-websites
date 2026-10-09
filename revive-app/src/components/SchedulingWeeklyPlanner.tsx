import {useCallback,useEffect,useRef,useState,type ReactElement} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {
 addPlannerDays,
 addPlannerMonths,
 assignmentConflict,
 jobVacancies,
 loadPlannerData,
 localPlannerDate,
 plannerMonday,
 plannerMonth,
 plannerMonthDays,
 plannerMonthHeading,
 spansPlannerDay,
 workerSetupIssue,
 type PlannerData,
 type PlannerJob,
 type PlannerLeave,
} from '@/services/schedulingPlanner';
import {formatSchedulingDate,formatSchedulingInstant,formatSchedulingTime} from '@/services/schedulingDisplay';

function openWorker(workerId:string){
 const card=document.getElementById(`scheduling-worker-${workerId}`);
 const details=card?.querySelector('details');
 if(details)details.open=true;
 card?.scrollIntoView({behavior:'smooth',block:'start'});
}

function openJob(jobId:string){
 document.getElementById(`scheduling-job-${jobId}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}

function periodPresentation(period:PlannerLeave){
 if(period.category==='leave')return{label:'Leave',className:'bg-purple-50 text-purple-950 border-purple-200'};
 if(period.category==='sickness')return{label:'Sickness',className:'bg-rose-50 text-rose-950 border-rose-300'};
 return{label:'Unavailable',className:'bg-slate-100 text-slate-800 border-slate-300'};
}

export function SchedulingWeeklyPlanner({workspaceId}:{workspaceId:string}){
 const initialDate=localPlannerDate(new Date().toISOString(),'Europe/London');
 const [data,setData]=useState<PlannerData|null>(null);
 const [busy,setBusy]=useState(false);
 const [stale,setStale]=useState(false);
 const [updated,setUpdated]=useState<string|null>(null);
 const [message,setMessage]=useState('');
 const [timezone,setTimezone]=useState('Europe/London');
 const [selectedDate,setSelectedDate]=useState(initialDate);
 const [viewMode,setViewMode]=useState<'week'|'month'>('week');
 const [workerFilter,setWorkerFilter]=useState('');
 const [locationFilter,setLocationFilter]=useState('');
 const mounted=useRef(true),sequence=useRef(0),running=useRef(false),refreshAgain=useRef(false);

 const reload=useCallback(async()=>{
  if(running.current){refreshAgain.current=true;return;}
  running.current=true;
  const token=++sequence.current;
  setBusy(true);
  try{
   const loaded=await loadPlannerData(workspaceId,async(table,columns,ws,from,to)=>{
    if(!supabaseClient)throw Error('Unavailable');
    const {data:rows,error}=await supabaseClient.from(table).select(columns).eq('workspace_id',ws).order('id',{ascending:true}).range(from,to);
    if(error)throw Error('Unavailable');
    return rows;
   });
   if(mounted.current&&token===sequence.current){
    setData(loaded);
    setStale(false);
    setUpdated(new Date().toISOString());
    setMessage('Planner updated.');
   }
  }catch{
   if(mounted.current&&token===sequence.current){
    setStale(true);
    setMessage('Planner could not be updated. Any visible schedule is the last successful view. Refresh before relying on it.');
   }
  }finally{
   if(token===sequence.current){
    running.current=false;
    if(mounted.current){
     setBusy(false);
     if(refreshAgain.current){
      refreshAgain.current=false;
      window.setTimeout(()=>window.dispatchEvent(new Event('rev-scheduling-changed')),0);
     }
    }
   }
  }
 },[workspaceId]);

 useEffect(()=>{
  mounted.current=true;
  void reload();
  const refresh=()=>{if(document.visibilityState!=='hidden')void reload();};
  const timer=window.setInterval(refresh,30000);
  window.addEventListener('focus',refresh);
  window.addEventListener('rev-scheduling-changed',refresh);
  document.addEventListener('visibilitychange',refresh);
  return()=>{
   mounted.current=false;
   sequence.current++;
   running.current=false;
   refreshAgain.current=false;
   window.clearInterval(timer);
   window.removeEventListener('focus',refresh);
   window.removeEventListener('rev-scheduling-changed',refresh);
   document.removeEventListener('visibilitychange',refresh);
  };
 },[reload]);

 const week=plannerMonday(selectedDate);
 const month=plannerMonth(selectedDate);
 const days=viewMode==='week'?Array.from({length:7},(_,index)=>addPlannerDays(week,index)):plannerMonthDays(month);
 const rangeStart=days[0],rangeEnd=days[days.length-1];
 const activeAssignments=data?.assignments.filter(assignment=>assignment.status==='active')??[];
 const jobs=data?.jobs.filter(job=>job.status==='open'&&(!locationFilter||job.location===locationFilter))??[];
 const visibleJobs=jobs.filter(job=>days.some(day=>spansPlannerDay(job.startAt,job.endAt,day,timezone)));
 const visibleWorkers=data?.workers
  .filter(worker=>(worker.active||activeAssignments.some(assignment=>assignment.workerId===worker.id&&days.some(day=>spansPlannerDay(assignment.startAt,assignment.endAt,day,timezone))))&&(!workerFilter||worker.id===workerFilter))
  .sort((first,second)=>first.name.localeCompare(second.name))??[];
 const visibleWorkerIds=new Set(visibleWorkers.map(worker=>worker.id));
 const workerName=(workerId:string)=>data?.workers.find(worker=>worker.id===workerId)?.name??'Unknown worker';
 const time=(value:string)=>formatSchedulingTime(value,timezone);

 const jobCard=(job:PlannerJob,label:string,conflict=false)=>(
  <button type="button" onClick={()=>openJob(job.id)} disabled={stale} className={`block w-full text-left rounded-lg border p-2 mb-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${conflict?'bg-red-50 border-red-300 text-red-900':label==='Assigned'?'bg-blue-50 border-blue-200 text-blue-950':'bg-amber-50 border-amber-300 text-amber-950'}`}>
   <span className="block font-semibold">{conflict?'Review needed':label}</span>
   <span className="block font-medium">{job.title}</span>
   <span className="block">{time(job.startAt)}-{time(job.endAt)}</span>
   <span className="block">{job.location}</span>
   {localPlannerDate(job.startAt,timezone)!==localPlannerDate(new Date(Date.parse(job.endAt)-1).toISOString(),timezone)&&<span className="block">Continues across days</span>}
   <span className="block mt-1 underline">View job</span>
  </button>
 );

 const compactJob=(key:string,job:PlannerJob,label:string,conflict=false)=>(
  <button key={key} type="button" onClick={()=>openJob(job.id)} disabled={stale} className={`block w-full rounded border px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${conflict?'bg-red-50 border-red-300 text-red-900':label.startsWith('Assigned')?'bg-blue-50 border-blue-200 text-blue-950':'bg-amber-50 border-amber-300 text-amber-950'}`}>
   <span className="block font-semibold">{conflict?'Review needed':label}</span>
   <span className="block truncate">{job.title}</span>
   <span className="block">{time(job.startAt)}-{time(job.endAt)}</span>
  </button>
 );

 const compactPeriod=(period:PlannerLeave)=>{const presentation=periodPresentation(period);return(
  <div key={`period:${period.id}`} className={`rounded border px-2 py-1 text-xs ${presentation.className}`}>
   <span className="block font-semibold">{presentation.label}</span>
   <span className="block truncate">{workerName(period.workerId)}</span>
  </div>
 );};

 const monthEntries=(day:string):ReactElement[]=>{
  if(!data)return[];
  const entries:ReactElement[]=[];
  for(const job of visibleJobs.filter(candidate=>jobVacancies(data,candidate)>0&&spansPlannerDay(candidate.startAt,candidate.endAt,day,timezone))){
   entries.push(compactJob(`unfilled:${job.id}`,job,`Unfilled: ${jobVacancies(data,job)}`));
  }
  for(const assignment of activeAssignments.filter(candidate=>visibleWorkerIds.has(candidate.workerId)&&spansPlannerDay(candidate.startAt,candidate.endAt,day,timezone))){
   const job=jobs.find(candidate=>candidate.id===assignment.jobId);
   if(job)entries.push(compactJob(`assignment:${assignment.id}`,job,`Assigned: ${workerName(assignment.workerId)}`,assignmentConflict(data,assignment)));
  }
  for(const period of data.leave.filter(candidate=>candidate.status==='active'&&visibleWorkerIds.has(candidate.workerId)&&spansPlannerDay(candidate.startAt,candidate.endAt,day,timezone))){
   entries.push(compactPeriod(period));
  }
  return entries;
 };

 const selectDate=(value:string)=>{
  if(!value)return;
  try{setSelectedDate(viewMode==='week'?plannerMonday(value):plannerMonth(value));}
  catch{setMessage('Choose a valid date.');}
 };
 const goToday=()=>setSelectedDate(localPlannerDate(new Date().toISOString(),timezone));

 return <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm my-6" aria-label="Scheduling planner">
  <div className="p-4 sm:p-6 border-b border-slate-200">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><h2 className="text-xl font-semibold text-slate-900">{viewMode==='week'?'Weekly planner':plannerMonthHeading(month)}</h2><p className="text-sm text-slate-600 mt-1">Saved work, assignments, leave, sickness and unavailable periods. Select a job card to manage it below.</p></div>
    <div className="inline-flex rounded-lg border border-slate-300 p-1" role="group" aria-label="Planner view">
     <button type="button" className={viewMode==='week'?'btn-primary':'btn-secondary'} aria-pressed={viewMode==='week'} onClick={()=>setViewMode('week')}>WEEK</button>
     <button type="button" className={viewMode==='month'?'btn-primary ml-1':'btn-secondary ml-1'} aria-pressed={viewMode==='month'} onClick={()=>setViewMode('month')}>MONTH</button>
    </div>
   </div>
   <div className="flex flex-wrap items-end gap-3 mt-4">
    {viewMode==='week'?<>
     <button className="btn-secondary" onClick={()=>setSelectedDate(addPlannerDays(week,-7))}>Previous week</button>
     <label className="text-sm">Week beginning<input aria-label="Week beginning" className="block border rounded p-2" type="date" value={week} onChange={event=>selectDate(event.target.value)}/></label>
     <button className="btn-secondary" onClick={()=>setSelectedDate(addPlannerDays(week,7))}>Next week</button>
     <button className="btn-secondary" onClick={goToday}>This week</button>
    </>:<>
     <button className="btn-secondary" onClick={()=>setSelectedDate(addPlannerMonths(month,-1))}>Previous month</button>
     <label className="text-sm">Month containing<input aria-label="Month containing" className="block border rounded p-2" type="date" value={selectedDate} onChange={event=>selectDate(event.target.value)}/></label>
     <button className="btn-secondary" onClick={()=>setSelectedDate(addPlannerMonths(month,1))}>Next month</button>
     <button className="btn-secondary" onClick={goToday}>Today</button>
    </>}
    <label className="text-sm">Display timezone<select className="block border rounded p-2" value={timezone} onChange={event=>setTimezone(event.target.value)}><option>Europe/London</option><option>UTC</option><option>America/New_York</option></select></label>
    <button className="btn-primary" disabled={busy} onClick={()=>void reload()}>{busy?'Updating…':'REFRESH PLANNER'}</button>
   </div>
   <div className="flex flex-wrap gap-3 mt-3">
    <label className="text-sm">Worker<select className="block border rounded p-2" value={workerFilter} onChange={event=>setWorkerFilter(event.target.value)}><option value="">All workers</option>{data?.workers.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
    <label className="text-sm">Location<select className="block border rounded p-2" value={locationFilter} onChange={event=>setLocationFilter(event.target.value)}><option value="">All locations</option>{[...new Set(data?.jobs.filter(job=>job.status==='open').map(job=>job.location)??[])].sort().map(location=><option key={location} value={location}>{location}</option>)}</select></label>
   </div>
   <p role="status" className={`text-sm mt-3 ${stale?'text-red-800':'text-slate-600'}`}>{busy?'Updating planner…':message} {updated&&`Last successful update: ${new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(updated))} (${timezone}).`}</p>
   <p className="text-xs text-slate-500 mt-1">Refreshes every 30 seconds while this page is visible and after saved changes. Cancelled records are kept in history below.</p>
   <div className="flex flex-wrap gap-2 mt-3 text-xs">
    <span className="rounded px-2 py-1 bg-blue-50 text-blue-950 border border-blue-200">Assigned</span>
    <span className="rounded px-2 py-1 bg-amber-50 text-amber-950 border border-amber-300">Unfilled</span>
    <span className="rounded px-2 py-1 bg-purple-50 text-purple-950 border border-purple-200">Leave</span>
    <span className="rounded px-2 py-1 bg-rose-50 text-rose-950 border border-rose-300">Sickness</span>
    <span className="rounded px-2 py-1 bg-slate-100 text-slate-800 border border-slate-300">Unavailable</span>
    <span className="rounded px-2 py-1 bg-red-50 text-red-950 border border-red-300">Review needed</span>
   </div>
  </div>

  {data&&viewMode==='week'&&<div className="max-w-full overflow-x-auto">
   <table className="w-full border-collapse text-sm" style={{minWidth:1100}}>
    <caption className="sr-only">Weekly schedule in {timezone}, week beginning {formatSchedulingDate(week)}</caption>
    <thead><tr className="bg-slate-50"><th scope="col" className="text-left p-3 border-b w-44">Worker / work</th>{days.map(day=><th key={day} scope="col" className="text-left p-3 border-b">{formatSchedulingDate(day)}</th>)}</tr></thead>
    <tbody>
     <tr><th scope="row" className="text-left p-3 border-b align-top text-amber-900">Unfilled work<p className="text-xs font-normal">{visibleJobs.reduce((sum,job)=>sum+jobVacancies(data,job),0)} places still needed</p></th>{days.map(day=><td key={day} className="p-2 border-b border-l align-top">{visibleJobs.filter(job=>jobVacancies(data,job)>0&&spansPlannerDay(job.startAt,job.endAt,day,timezone)).map(job=><div key={job.id}>{jobCard(job,`Unfilled: ${jobVacancies(data,job)}`)}</div>)}</td>)}</tr>
     {visibleWorkers.map(worker=><tr key={worker.id}><th scope="row" className="text-left p-3 border-b align-top"><span className="font-semibold text-slate-900">{worker.name}</span>{workerSetupIssue(data,worker.id,rangeStart,rangeEnd)&&<><p className="text-xs text-amber-800 mt-1">{workerSetupIssue(data,worker.id,rangeStart,rangeEnd)}</p><button className="text-xs underline text-blue-800 mt-1" onClick={()=>openWorker(worker.id)}>SET WORKING HOURS</button></>}</th>{days.map(day=><td key={day} className="p-2 border-b border-l align-top">{activeAssignments.filter(assignment=>assignment.workerId===worker.id&&jobs.some(job=>job.id===assignment.jobId)&&spansPlannerDay(assignment.startAt,assignment.endAt,day,timezone)).map(assignment=>{const job=jobs.find(candidate=>candidate.id===assignment.jobId)!;return <div key={assignment.id}>{jobCard(job,'Assigned',assignmentConflict(data,assignment))}</div>;})}{data.leave.filter(period=>period.workerId===worker.id&&period.status==='active'&&spansPlannerDay(period.startAt,period.endAt,day,timezone)).map(period=>{const presentation=periodPresentation(period);return <div key={period.id} className={`rounded-lg border p-2 mb-2 text-xs ${presentation.className}`}><p className="font-semibold">{presentation.label}</p><p>{formatSchedulingInstant(period.startAt,timezone)} to {formatSchedulingInstant(period.endAt,timezone)}</p></div>;})}</td>)}</tr>)}
    </tbody>
   </table>
   {visibleWorkers.length===0&&<p className="p-4 text-sm text-slate-600">No workers match this view.</p>}
   {visibleJobs.length===0&&<p className="p-4 text-sm text-slate-600">No open jobs in this week and location.</p>}
  </div>}

  {data&&viewMode==='month'&&<div className="max-w-full overflow-x-auto" aria-label={`${plannerMonthHeading(month)} month planner`}>
   <div className="grid min-w-[70rem] grid-cols-7 bg-slate-100 gap-px">
    {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=><div key={day} className="bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{day}</div>)}
    {days.map(day=>{const entries=monthEntries(day),outside=day.slice(0,7)!==month.slice(0,7);return <article key={day} aria-label={formatSchedulingDate(day)} className={`min-h-44 p-2 ${outside?'bg-slate-50 text-slate-500':'bg-white text-slate-900'}`}>
     <h3 className="mb-2 text-sm font-semibold"><time dateTime={day}>{formatSchedulingDate(day)}</time></h3>
     <div className="space-y-1">{entries.slice(0,3)}{entries.length>3&&<details className="rounded border border-slate-300 bg-white p-1"><summary className="cursor-pointer text-xs font-medium text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">More entries ({entries.length-3})</summary><div className="mt-1 space-y-1">{entries.slice(3)}</div></details>}</div>
    </article>;})}
   </div>
   {visibleWorkers.length===0&&<p className="p-4 text-sm text-slate-600">No workers match this view.</p>}
   {visibleJobs.length===0&&<p className="p-4 text-sm text-slate-600">No open jobs in this month and location.</p>}
  </div>}

  {!data&&!busy&&<p className="p-4 text-sm">Planner unavailable. Use Refresh planner to try again.</p>}
 </section>;
}
