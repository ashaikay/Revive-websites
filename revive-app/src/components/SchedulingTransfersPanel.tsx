import {useEffect,useState} from 'react';
import type {PlannerData} from '@/services/schedulingPlanner';
import {
 clearJobImport,csvText,jobImportTemplate,JobImportRefused,previewJobImport,rememberJobImport,restoreJobImport,scheduleExportRows,submitJobImport,
 type JobImportAttempt,type JobImportPreview,
} from '@/services/schedulingTransfers';
import {supabaseClient} from '@/data/supabaseClient';

function download(name:string,body:string){
 const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}
export function SchedulingTransfersPanel({workspaceId,userId,data,startDate,endDate,timezone,workerId,location,periodLabel,stale}:{workspaceId:string;userId:string;data:PlannerData;startDate:string;endDate:string;timezone:string;workerId:string;location:string;periodLabel:'WEEK'|'MONTH';stale:boolean}){
 const [assignmentStart,setAssignmentStart]=useState(startDate),[assignmentEnd,setAssignmentEnd]=useState(endDate);
 const [preview,setPreview]=useState<JobImportPreview|null>(null),[pending,setPending]=useState<JobImportAttempt|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{try{setPending(restoreJobImport(window.sessionStorage,workspaceId,userId));}catch{setMessage('A retained job import could not be read. Contact support before importing another file.');}},[workspaceId,userId]);
 const filename=(kind:string,from:string,to:string)=>`rev-${kind}-${from}-to-${to}.csv`;
 const exportSchedule=()=>{download(filename('schedule',startDate,endDate),csvText(scheduleExportRows(data,{startDate,endDate,timezone,workerId:workerId||undefined,location:location||undefined})));setMessage(`Downloaded the selected schedule from ${startDate} to ${endDate} in ${timezone}. This is not a funder report or payroll calculation.`);};
 const exportAssignments=()=>{try{download(filename('assignments',assignmentStart,assignmentEnd),csvText(scheduleExportRows(data,{startDate:assignmentStart,endDate:assignmentEnd,timezone,assignmentsOnly:true,workerId:workerId||undefined,location:location||undefined})));setMessage(`Downloaded assignment records from ${assignmentStart} to ${assignmentEnd} in ${timezone}. This is not a funder report or payroll calculation.`);}catch{setMessage('Choose a valid assignment date range.');}};
 const readFile=async(file:File|undefined)=>{setPreview(null);setMessage('');if(!file)return;try{setPreview(previewJobImport(await file.text(),workspaceId,data.jobs,()=>crypto.randomUUID()));}catch(error){setMessage(error instanceof Error?error.message:'The CSV could not be read.');}};
 const save=async(retry=false)=>{
  if(busy)return;let attempt=retry?pending:null;
  if(!attempt){if(!preview?.canConfirm){setMessage('Fix every row error before confirming the import.');return;}attempt={workspaceId,batchRequestId:crypto.randomUUID(),rows:preview.rows.map(row=>row.attempt!)};try{rememberJobImport(window.sessionStorage,userId,attempt);}catch{setMessage('The import was not sent because its retry details could not be retained safely.');return;}setPending(attempt);}
  setBusy(true);setMessage(retry?'Retrying the exact retained import...':'Saving the confirmed job import...');
  try{
   const result=await submitJobImport(attempt,async(name,body)=>{if(!supabaseClient)throw Error('Unavailable');const {data:response,error}=await supabaseClient.functions.invoke(name,{body});if(error){const context=(error as {context?:unknown}).context;if(context instanceof Response)return{status:context.status,data:await context.clone().json().catch(()=>null)};throw Error('Unavailable');}return{status:200,data:response};});
   clearJobImport(window.sessionStorage,workspaceId,userId);setPending(null);setPreview(null);setMessage(`${result.savedCount} job record${result.savedCount===1?'':'s'} saved. No workers were assigned or notified.`);window.dispatchEvent(new Event('rev-scheduling-changed'));
  }catch(error){
   if(error instanceof JobImportRefused){clearJobImport(window.sessionStorage,workspaceId,userId);setPending(null);setMessage(`Not saved. ${error.message} No imported rows were created.`);}
   else setMessage('Import outcome unconfirmed. The exact batch and row request IDs are retained. Check current jobs, then retry this same import; do not upload a replacement file.');
  }finally{setBusy(false);}
 };
 return <details className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-4">
  <summary className="cursor-pointer font-semibold">Schedule downloads and job CSV upload</summary>
  <p className="mt-2 text-sm text-slate-700">Downloads contain only Scheduling records available in this workspace. They are operational exports, not funder reports or payroll calculations.</p>
  <section className="mt-4" aria-labelledby="schedule-download-heading"><h3 id="schedule-download-heading" className="font-semibold">Downloads</h3>
   <div className="mt-2 flex flex-wrap items-end gap-3"><button type="button" className="btn-secondary" disabled={stale} onClick={exportSchedule}>DOWNLOAD SELECTED {periodLabel} CSV</button>
    <label className="text-sm">Assignment range start<input className="block border rounded p-2" type="date" value={assignmentStart} onChange={event=>setAssignmentStart(event.target.value)}/></label>
    <label className="text-sm">Assignment range end<input className="block border rounded p-2" type="date" value={assignmentEnd} onChange={event=>setAssignmentEnd(event.target.value)}/></label>
    <button type="button" className="btn-secondary" disabled={stale||!assignmentStart||!assignmentEnd||assignmentStart>assignmentEnd} onClick={exportAssignments}>DOWNLOAD ASSIGNMENTS CSV</button>
   </div>
  </section>
  <section className="mt-5 border-t pt-4" aria-labelledby="job-upload-heading"><h3 id="job-upload-heading" className="font-semibold">Job-record upload</h3>
   <p className="mt-1 text-sm text-slate-700">Only the REV job template is supported. Worker, leave, sickness, unavailability and assignment imports are not available.</p>
   <button type="button" className="btn-secondary mt-2" onClick={()=>download('rev-job-import-template.csv',jobImportTemplate())}>DOWNLOAD JOB TEMPLATE</button>
   {!pending&&<label className="mt-3 block text-sm font-medium">Choose completed job CSV<input aria-label="Choose completed job CSV" className="mt-1 block" type="file" accept=".csv,text/csv" onChange={event=>void readFile(event.target.files?.[0])}/></label>}
   {preview&&<div className="mt-3"><p className="text-sm">{preview.rows.length} row{preview.rows.length===1?'':'s'} parsed. Review all errors and warnings before confirmation.</p><div className="mt-2 max-w-full overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Line</th><th className="p-2 text-left">Job</th><th className="p-2 text-left">Result</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.line} className="border-t"><td className="p-2">{row.line}</td><td className="p-2">{row.attempt?.title??'Invalid row'}</td><td className="p-2">{row.errors.length?row.errors.join(' '):row.warnings.length?`Warning: ${row.warnings.join(' ')}`:'Ready'}</td></tr>)}</tbody></table></div>
    <button type="button" className="btn-primary mt-3" disabled={!preview.canConfirm||busy} onClick={()=>void save(false)}>CONFIRM AND SAVE JOBS</button><button type="button" className="btn-secondary mt-3 ml-2" disabled={busy} onClick={()=>{setPreview(null);setMessage('Import preview discarded. Nothing was saved.');}}>DISCARD PREVIEW</button>
   </div>}
   {pending&&<div role="alert" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3"><p>The earlier import has an unconfirmed outcome. Its exact request IDs and rows are retained.</p><button type="button" className="btn-primary mt-2" disabled={busy} onClick={()=>void save(true)}>{busy?'RETRYING...':'RETRY SAME JOB IMPORT'}</button></div>}
  </section>
  {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
 </details>;
}
