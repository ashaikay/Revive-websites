import {useEffect,useMemo,useState} from 'react';
import type {PlannerData} from '@/services/schedulingPlanner';
import {
 buildSchedulingReportRows,
 csvText,
 inspectSchedulingTemplate,
 mappedPreview,
 neutralizeSpreadsheetText,
 populateSchedulingTemplate,
 scheduleExportRows,
 schedulingReportFields,
 standardReportMatrix,
 templateColumns,
 type SchedulingReportField,
 type SchedulingReportRow,
 type SchedulingReportStatus,
 type SchedulingTemplate,
 type SchedulingTemplateColumn,
 type SchedulingTemplateMapping,
} from '@/services/schedulingReporting';

function download(name:string,body:BlobPart,type:string){
 const url=URL.createObjectURL(new Blob([body],{type}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}
const reportFilename=(kind:string,from:string,to:string,extension:string)=>`rev-${kind}-${from}-to-${to}.${extension}`;

export function SchedulingReportingPanel({data,startDate,endDate,timezone,workerId,location,periodLabel,stale}:{data:PlannerData;startDate:string;endDate:string;timezone:string;workerId:string;location:string;periodLabel:'WEEK'|'MONTH';stale:boolean}){
 const [reportStart,setReportStart]=useState(startDate),[reportEnd,setReportEnd]=useState(endDate);
 const [assignmentStart,setAssignmentStart]=useState(startDate),[assignmentEnd,setAssignmentEnd]=useState(endDate);
 const [workerIds,setWorkerIds]=useState<string[]>(workerId?[workerId]:[]);
 const [reportLocation,setReportLocation]=useState(location);
 const [status,setStatus]=useState<SchedulingReportStatus>('current');
 const [report,setReport]=useState<SchedulingReportRow[]|null>(null);
 const [template,setTemplate]=useState<SchedulingTemplate|null>(null);
 const [templateName,setTemplateName]=useState('');
 const [sheetName,setSheetName]=useState('');
 const [headerRow,setHeaderRow]=useState(1);
 const [columns,setColumns]=useState<SchedulingTemplateColumn[]>([]);
 const [mapping,setMapping]=useState<SchedulingTemplateMapping>({});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const locations=useMemo(()=>[...new Set(data.jobs.map(job=>job.location))].sort((left,right)=>left.localeCompare(right)),[data.jobs]);

 useEffect(()=>{setReportStart(startDate);setReportEnd(endDate);setAssignmentStart(startDate);setAssignmentEnd(endDate);setReport(null);},[startDate,endDate]);
 useEffect(()=>{setWorkerIds(workerId?[workerId]:[]);setReport(null);},[workerId]);
 useEffect(()=>{setReportLocation(location);setReport(null);},[location]);

 const options={startDate:reportStart,endDate:reportEnd,timezone,workerIds,location:reportLocation,status};
 const exportSchedule=()=>{download(reportFilename('schedule-export',startDate,endDate,'csv'),csvText(scheduleExportRows(data,{startDate,endDate,timezone,workerId:workerId||undefined,location:location||undefined})),'text/csv;charset=utf-8');setMessage(`Downloaded the selected ${periodLabel.toLowerCase()} schedule export. This is a direct operational export, not a generated report, funder return or payroll calculation.`);};
 const exportAssignments=()=>{try{download(reportFilename('assignment-export',assignmentStart,assignmentEnd,'csv'),csvText(scheduleExportRows(data,{startDate:assignmentStart,endDate:assignmentEnd,timezone,assignmentsOnly:true,workerId:workerId||undefined,location:location||undefined})),'text/csv;charset=utf-8');setMessage('Downloaded the direct assignment export for the selected range.');}catch(error){setMessage(error instanceof Error?error.message:'Choose a valid assignment date range.');}};
 const generate=()=>{try{const rows=buildSchedulingReportRows(data,options);if(template)mappedPreview(rows,columns,mapping);setReport(rows);setMessage('Report preview generated from the last complete Scheduling refresh. No Scheduling records were changed.');}catch(error){setReport(null);setMessage(error instanceof Error?error.message:'The report could not be generated.');}};
 const selectTemplateLocation=(nextTemplate:SchedulingTemplate,nextSheet:string,nextHeader:number)=>{
  try{
   const nextColumns=templateColumns(nextTemplate,nextSheet,nextHeader),nextMapping:SchedulingTemplateMapping={};
   for(const column of nextColumns){
    const normalized=column.header.trim().toLocaleLowerCase();
    const match=schedulingReportFields.find(field=>field.label.toLocaleLowerCase()===normalized||field.key===normalized.replace(/\s+/g,'_'));
    nextMapping[column.column]=match?.key??'';
   }
   setColumns(nextColumns);setMapping(nextMapping);setMessage('Template inspected. Review every column mapping before generating the report.');
  }catch(error){setColumns([]);setMapping({});setMessage(error instanceof Error?error.message:'The selected template headers could not be read.');}
 };
 const readTemplate=async(file:File|undefined)=>{
  setTemplate(null);setTemplateName('');setColumns([]);setMapping({});setReport(null);if(!file)return;
  setBusy(true);setMessage('Inspecting the workbook without executing formulas or links...');
  try{
   const inspected=await inspectSchedulingTemplate(file),first=inspected.sheets[0];
   setTemplate(inspected);setTemplateName(file.name);setSheetName(first.name);setHeaderRow(1);selectTemplateLocation(inspected,first.name,1);
  }catch(error){setMessage(error instanceof Error?error.message:'The workbook could not be inspected safely.');}
  finally{setBusy(false);}
 };
 const downloadTemplateReport=async()=>{
  if(!template||!report)return;
  setBusy(true);setMessage('Creating a populated copy. The uploaded original is unchanged.');
  try{
   const output=await populateSchedulingTemplate(template,sheetName,headerRow,columns,mapping,report);
   download(reportFilename('scheduling-report',reportStart,reportEnd,'xlsx'),output,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   setMessage('Downloaded the populated XLSX copy. The original template remains unchanged and is retained only in this browser session.');
  }catch(error){setMessage(error instanceof Error?error.message:'The populated workbook could not be created.');}
  finally{setBusy(false);}
 };
 let preview:string[][]=[];
 try{if(report)preview=template?mappedPreview(report,columns,mapping):standardReportMatrix(report).slice(0,11);}catch{preview=[];}
 const selectedNames=workerIds.map(id=>data.workers.find(worker=>worker.id===id)?.name).filter(Boolean);

 return <details className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-4">
  <summary className="cursor-pointer font-semibold">Schedule exports and reporting</summary>
  <p className="mt-2 text-sm text-slate-700">Exports copy existing records directly. Reports add selected filters, a preview and optional organisation-template mapping. Neither workflow calculates payroll, costs, hours, outcomes or funder measures.</p>
  <section className="mt-4" aria-labelledby="schedule-export-heading"><h3 id="schedule-export-heading" className="font-semibold">Direct schedule exports</h3>
   <div className="mt-2 flex flex-wrap items-end gap-3"><button type="button" className="btn-secondary" disabled={stale} onClick={exportSchedule}>DOWNLOAD SELECTED {periodLabel} CSV</button>
    <label className="text-sm">Assignment range start<input className="block rounded border p-2" type="date" value={assignmentStart} onChange={event=>setAssignmentStart(event.target.value)}/></label>
    <label className="text-sm">Assignment range end<input className="block rounded border p-2" type="date" value={assignmentEnd} onChange={event=>setAssignmentEnd(event.target.value)}/></label>
    <button type="button" className="btn-secondary" disabled={stale||!assignmentStart||!assignmentEnd||assignmentStart>assignmentEnd} onClick={exportAssignments}>DOWNLOAD ASSIGNMENTS CSV</button>
   </div>
  </section>
  <section className="mt-5 border-t pt-4" aria-labelledby="report-heading"><h3 id="report-heading" className="font-semibold">Generate a Scheduling report</h3>
   <p className="mt-1 text-sm text-slate-700">Use the standard CSV report, or upload a simple XLSX template containing unique headers and no existing data rows. Absence categories are limited to Leave, Sickness and Unavailable; no medical details are included.</p>
   <div className="mt-3 flex flex-wrap items-start gap-3">
    <label className="text-sm">Report start<input aria-label="Report start" className="block rounded border p-2" type="date" value={reportStart} onChange={event=>{setReportStart(event.target.value);setReport(null);}}/></label>
    <label className="text-sm">Report end<input aria-label="Report end" className="block rounded border p-2" type="date" value={reportEnd} onChange={event=>{setReportEnd(event.target.value);setReport(null);}}/></label>
    <label className="text-sm">Report location<select aria-label="Report location" className="block rounded border p-2" value={reportLocation} onChange={event=>{setReportLocation(event.target.value);setReport(null);}}><option value="">All locations</option>{locations.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <label className="text-sm">Record status<select aria-label="Report status" className="block rounded border p-2" value={status} onChange={event=>{setStatus(event.target.value as SchedulingReportStatus);setReport(null);}}><option value="current">Current records</option><option value="cancelled">Cancelled records</option><option value="all">All recorded statuses</option></select></label>
   </div>
   <fieldset className="mt-3"><legend className="text-sm font-medium">Workers</legend><label className="mr-4 text-sm"><input type="checkbox" checked={!workerIds.length} onChange={()=>{setWorkerIds([]);setReport(null);}}/> All workers and unassigned jobs</label>{data.workers.map(worker=><label key={worker.id} className="mr-4 text-sm"><input type="checkbox" checked={workerIds.includes(worker.id)} onChange={event=>{setWorkerIds(current=>event.target.checked?[...current,worker.id]:current.filter(id=>id!==worker.id));setReport(null);}}/> {worker.name}{worker.active?'':' (archived)'}</label>)}</fieldset>
   <p className="mt-1 text-xs text-slate-600">{selectedNames.length?`Selected workers: ${selectedNames.join(', ')}. Unassigned jobs are omitted.`:'All authorised workers are included.'} {reportLocation?'Absence rows are omitted because absences have no recorded job location.':''}</p>
   <div className="mt-4 rounded border border-slate-200 bg-white p-3"><h4 className="font-medium">Optional organisation XLSX template</h4>
    <p className="mt-1 text-xs text-slate-600">Maximum 5 MB, 10 visible sheets, 200 existing rows and 50 columns per sheet. Macros, encryption, protection, formulas, hyperlinks, external links, merged cells, drawings, tables and existing data rows below the selected header are rejected.</p>
    <label className="mt-2 block text-sm">Choose XLSX template<input aria-label="Choose XLSX template" className="mt-1 block" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>void readTemplate(event.target.files?.[0])}/></label>
    {template&&<><div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">Worksheet<select aria-label="Template worksheet" className="block rounded border p-2" value={sheetName} onChange={event=>{const value=event.target.value;setSheetName(value);setReport(null);selectTemplateLocation(template,value,headerRow);}}>{template.sheets.map(sheet=><option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</select></label>
     <label className="text-sm">Header row<select aria-label="Template header row" className="block rounded border p-2" value={headerRow} onChange={event=>{const value=Number(event.target.value);setHeaderRow(value);setReport(null);selectTemplateLocation(template,sheetName,value);}}>{Array.from({length:template.sheets.find(sheet=>sheet.name===sheetName)?.maxHeaderRow??1},(_,index)=><option key={index+1} value={index+1}>{index+1}</option>)}</select></label></div>
     <p className="mt-2 text-xs text-slate-600">Uploaded original: {templateName}. It is not modified; the download is a separate populated copy of the selected worksheet.</p>
     <button type="button" className="btn-secondary mt-2" onClick={()=>download(templateName,template.original,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>DOWNLOAD UNCHANGED ORIGINAL</button>
     {columns.length>0&&<div className="mt-3"><h5 className="text-sm font-medium">Column mapping</h5><div className="grid gap-2 md:grid-cols-2">{columns.map(column=><label key={column.column} className="text-sm">{column.header}<select aria-label={`Map ${column.header}`} className="block w-full rounded border p-2" value={mapping[column.column]??''} onChange={event=>{setMapping(current=>({...current,[column.column]:event.target.value as SchedulingReportField|''}));setReport(null);}}><option value="">Leave blank — unsupported or not required</option>{schedulingReportFields.map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select></label>)}</div></div>}</>}
   </div>
   <button type="button" className="btn-primary mt-3" disabled={stale||busy||!reportStart||!reportEnd||reportStart>reportEnd||(Boolean(template)&&!columns.length)} onClick={generate}>GENERATE REPORT PREVIEW</button>
   {report&&<div className="mt-4"><p className="text-sm">{report.length} report row{report.length===1?'':'s'} generated. Blank cells mean that the selected record type has no supported value for that field.</p>{report.length===0&&<p className="mt-1 text-sm">No authorised Scheduling records match these filters. The downloadable report contains headers only.</p>}
    {preview.length>0&&<div className="mt-2 max-w-full overflow-x-auto"><table className="w-full text-xs"><thead><tr>{preview[0].map((heading,index)=><th key={`${heading}-${index}`} className="border p-2 text-left">{heading}</th>)}</tr></thead><tbody>{preview.slice(1).map((row,rowIndex)=><tr key={rowIndex}>{row.map((value,index)=><td key={index} className="border p-2">{neutralizeSpreadsheetText(value)}</td>)}</tr>)}</tbody></table></div>}
    {!template?<button type="button" className="btn-primary mt-3" onClick={()=>download(reportFilename('scheduling-report',reportStart,reportEnd,'csv'),csvText(standardReportMatrix(report)),'text/csv;charset=utf-8')}>DOWNLOAD STANDARD REPORT CSV</button>:<button type="button" className="btn-primary mt-3" disabled={busy||!preview.length} onClick={()=>void downloadTemplateReport()}>DOWNLOAD POPULATED XLSX REPORT</button>}
   </div>}
  </section>
  {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
 </details>;
}
