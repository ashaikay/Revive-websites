import {addPlannerDays,type PlannerData} from './schedulingPlanner';
import {localLeaveToUtc} from './workerUnavailability';

export const schedulingReportFields=[
 {key:'record_type',label:'Record type'},
 {key:'worker',label:'Worker'},
 {key:'worker_status',label:'Worker status'},
 {key:'job',label:'Job'},
 {key:'job_status',label:'Job status'},
 {key:'assignment_status',label:'Assignment status'},
 {key:'date',label:'Start date'},
 {key:'local_start',label:'Local start time'},
 {key:'end_date',label:'End date'},
 {key:'local_end',label:'Local end time'},
 {key:'timezone',label:'Report timezone'},
 {key:'location',label:'Location'},
 {key:'absence_category',label:'Absence category'},
 {key:'absence_status',label:'Absence status'},
] as const;
export type SchedulingReportField=typeof schedulingReportFields[number]['key'];
export type SchedulingReportRow=Record<SchedulingReportField,string>;
export type SchedulingReportStatus='all'|'current'|'cancelled';
export interface SchedulingReportOptions {
 startDate:string;
 endDate:string;
 timezone:string;
 workerIds:string[];
 location:string;
 status:SchedulingReportStatus;
}

const dangerousFormula=/^[\t\r\n ]*[=+\-@]/;
export function neutralizeSpreadsheetText(value:string){return dangerousFormula.test(value)?`'${value}`:value;}
const csvCell=(value:string)=>{const safe=neutralizeSpreadsheetText(value);return /[",\r\n]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;};
export const csvText=(rows:string[][])=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';

function localParts(value:string,timezone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=(type:string)=>parts.find(part=>part.type===type)?.value??'';
 return{date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}
function validateOptions(options:SchedulingReportOptions){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(options.endDate)||options.startDate>options.endDate)throw Error('Choose a valid report date range.');
 new Intl.DateTimeFormat('en-GB',{timeZone:options.timezone});
 if(!['all','current','cancelled'].includes(options.status))throw Error('Choose a supported record status.');
}
const blankRow=():SchedulingReportRow=>Object.fromEntries(schedulingReportFields.map(field=>[field.key,''])) as SchedulingReportRow;
const statusMatches=(value:string,filter:SchedulingReportStatus)=>filter==='all'||(filter==='cancelled'?value==='cancelled':value!=='cancelled');

export function buildSchedulingReportRows(data:PlannerData,options:SchedulingReportOptions):SchedulingReportRow[]{
 validateOptions(options);
 const start=localLeaveToUtc(`${options.startDate}T00:00`,options.timezone);
 const end=localLeaveToUtc(`${addPlannerDays(options.endDate,1)}T00:00`,options.timezone);
 const selectedWorkers=new Set(options.workerIds);
 const workers=new Map(data.workers.map(worker=>[worker.id,worker]));
 const jobs=new Map(data.jobs.map(job=>[job.id,job]));
 const inRange=(from:string,to:string)=>from<end&&to>start;
 const rows:SchedulingReportRow[]=[];
 const assignments=data.assignments
  .filter(item=>inRange(item.startAt,item.endAt)&&(!selectedWorkers.size||selectedWorkers.has(item.workerId))&&statusMatches(item.status,options.status))
  .filter(item=>{const job=jobs.get(item.jobId);return Boolean(job)&&(!options.location||job?.location===options.location);})
  .sort((left,right)=>left.startAt.localeCompare(right.startAt));
 for(const assignment of assignments){
  const worker=workers.get(assignment.workerId),job=jobs.get(assignment.jobId)!;
  const from=localParts(assignment.startAt,options.timezone),to=localParts(assignment.endAt,options.timezone);
  rows.push({...blankRow(),record_type:'Assignment',worker:worker?.name??'Unknown worker',worker_status:worker?.active?'Active':'Archived',job:job.title,job_status:job.status,assignment_status:assignment.status,date:from.date,local_start:from.time,end_date:to.date,local_end:to.time,timezone:options.timezone,location:job.location});
 }
 const assignedJobIds=new Set(assignments.map(item=>item.jobId));
 if(!selectedWorkers.size){
  for(const job of data.jobs.filter(item=>inRange(item.startAt,item.endAt)&&!assignedJobIds.has(item.id)&&(!options.location||item.location===options.location)&&statusMatches(item.status,options.status)).sort((left,right)=>left.startAt.localeCompare(right.startAt))){
   const from=localParts(job.startAt,options.timezone),to=localParts(job.endAt,options.timezone);
   rows.push({...blankRow(),record_type:'Job',job:job.title,job_status:job.status,date:from.date,local_start:from.time,end_date:to.date,local_end:to.time,timezone:options.timezone,location:job.location});
  }
 }
 if(!options.location){
  for(const period of data.leave.filter(item=>inRange(item.startAt,item.endAt)&&(!selectedWorkers.size||selectedWorkers.has(item.workerId))&&statusMatches(item.status,options.status)).sort((left,right)=>left.startAt.localeCompare(right.startAt))){
   const worker=workers.get(period.workerId),from=localParts(period.startAt,options.timezone),to=localParts(period.endAt,options.timezone);
   const category=period.category==='leave'?'Leave':period.category==='sickness'?'Sickness':'Unavailable';
   rows.push({...blankRow(),record_type:'Absence',worker:worker?.name??'Unknown worker',worker_status:worker?.active?'Active':'Archived',date:from.date,local_start:from.time,end_date:to.date,local_end:to.time,timezone:options.timezone,absence_category:category,absence_status:period.status});
  }
 }
 if(rows.length>5000)throw Error('The selected report exceeds 5,000 rows. Choose a smaller date range or narrower filters.');
 return rows.sort((left,right)=>left.date.localeCompare(right.date)||left.local_start.localeCompare(right.local_start)||left.record_type.localeCompare(right.record_type));
}

export function standardReportMatrix(rows:SchedulingReportRow[]):string[][]{
 return[
  schedulingReportFields.map(field=>field.label),
  ...rows.map(row=>schedulingReportFields.map(field=>row[field.key])),
 ];
}

export interface ScheduleExportOptions {startDate:string;endDate:string;timezone:string;assignmentsOnly?:boolean;workerId?:string;location?:string;}
export function scheduleExportRows(data:PlannerData,options:ScheduleExportOptions):string[][]{
 const rows=buildSchedulingReportRows(data,{startDate:options.startDate,endDate:options.endDate,timezone:options.timezone,location:options.location??'',workerIds:options.workerId?[options.workerId]:[],status:'all'});
 const header=['record_type','worker','job','date','local_start','local_end','timezone','recorded_status'];
 const exported=rows
  .filter(row=>!options.assignmentsOnly||row.record_type==='Assignment')
  .map(row=>[row.record_type==='Absence'?row.absence_category:row.record_type,row.worker,row.job,row.date,row.local_start,row.local_end,row.timezone,row.assignment_status||row.job_status||row.absence_status]);
 return[header,...exported];
}

const maxTemplateBytes=5*1024*1024,maxSheets=10,maxRows=200,maxColumns=50;
const unsupportedWorkbookNodes=new Set(['workbookProtection','externalReferences','pivotCaches','oleSize','customWorkbookViews','webPublishObjects']);
const unsupportedSheetNodes=new Set(['sheetProtection','protectedRanges','mergeCells','scenarios','dataConsolidate','customSheetViews','hyperlinks','drawing','drawingHF','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts']);
const unsupportedPart=/(?:vbaProject|externalLinks|embeddings|activeX|customXml|connections|pivot|drawings|tables|ctrlProps|printerSettings)/i;

export interface SchedulingTemplateSheet{name:string;path:string;maxHeaderRow:number;maxColumn:number;values:Record<number,Record<number,string>>;}
export interface SchedulingTemplate {
 original:ArrayBuffer;
 sheets:SchedulingTemplateSheet[];
}
export interface SchedulingTemplateColumn{column:number;header:string;}
export type SchedulingTemplateMapping=Record<number,SchedulingReportField|''>;

const elements=(root:Document|Element,name:string)=>[...root.getElementsByTagName('*')].filter(element=>element.localName===name);
function parseXml(text:string,label:string){
 const document=new DOMParser().parseFromString(text,'application/xml');
 if(elements(document,'parsererror').length)throw Error(`The XLSX ${label} is malformed.`);
 return document;
}
function zipPath(base:string,target:string){
 if(target.startsWith('/'))return target.slice(1);
 const parts=[...base.split('/').slice(0,-1),...target.split('/')],resolved:string[]=[];
 for(const part of parts){if(part==='..')resolved.pop();else if(part!=='.'&&part)resolved.push(part);}
 return resolved.join('/');
}
function columnNumber(reference:string){
 const letters=reference.match(/^[A-Z]+/i)?.[0].toUpperCase();if(!letters)return 0;
 return [...letters].reduce((total,letter)=>total*26+letter.charCodeAt(0)-64,0);
}
function cellText(cell:Element,shared:string[]){
 const type=cell.getAttribute('t'),value=elements(cell,'v')[0]?.textContent??'';
 if(type==='s')return shared[Number(value)]??'';
 if(type==='inlineStr')return elements(cell,'t').map(node=>node.textContent??'').join('');
 return value;
}
async function loadZip(bytes:ArrayBuffer){
 const {default:JSZip}=await import('jszip');
 try{return await JSZip.loadAsync(bytes);}catch{throw Error('The XLSX file is malformed, encrypted or password protected.');}
}
async function requiredText(zip:Awaited<ReturnType<typeof loadZip>>,path:string){
 const file=zip.file(path);if(!file)throw Error('The XLSX package is incomplete.');
 return file.async('text');
}
export async function inspectSchedulingTemplate(file:{name:string;size:number;arrayBuffer():Promise<ArrayBuffer>}):Promise<SchedulingTemplate>{
 if(!file.name.toLowerCase().endsWith('.xlsx'))throw Error('Upload an .xlsx workbook. Macro-enabled, legacy Excel and OpenDocument files are not supported.');
 if(file.size<1||file.size>maxTemplateBytes)throw Error('The XLSX template must be no larger than 5 MB.');
 const original=(await file.arrayBuffer()).slice(0);
 const zip=await loadZip(original.slice(0)),partNames=Object.keys(zip.files);
 if(partNames.some(name=>unsupportedPart.test(name)))throw Error('Macros, external links, drawings, tables, pivots, embedded objects and other complex workbook features are not supported.');
 for(const name of partNames.filter(value=>value.endsWith('.rels'))){
  const relationships=parseXml(await requiredText(zip,name),'relationship data');
  if(elements(relationships,'Relationship').some(node=>node.getAttribute('TargetMode')==='External'))throw Error('External workbook links are not supported.');
 }
 const workbook=parseXml(await requiredText(zip,'xl/workbook.xml'),'workbook definition');
 if([...unsupportedWorkbookNodes].some(name=>elements(workbook,name).length))throw Error('Protected workbooks, external links, pivots and other complex workbook features are not supported.');
 const relationshipDocument=parseXml(await requiredText(zip,'xl/_rels/workbook.xml.rels'),'workbook relationships');
 const relationships=new Map(elements(relationshipDocument,'Relationship').map(node=>[node.getAttribute('Id')??'',zipPath('xl/workbook.xml',node.getAttribute('Target')??'')]));
 const sharedFile=zip.file('xl/sharedStrings.xml'),shared=sharedFile?elements(parseXml(await sharedFile.async('text'),'shared strings'),'si').map(node=>elements(node,'t').map(text=>text.textContent??'').join('')):[];
 const sheetNodes=elements(workbook,'sheet');if(!sheetNodes.length||sheetNodes.length>maxSheets)throw Error(`Templates must contain between 1 and ${maxSheets} worksheets.`);
 const sheets:SchedulingTemplateSheet[]=[];
 for(const sheetNode of sheetNodes){
  if(sheetNode.getAttribute('state')&&sheetNode.getAttribute('state')!=='visible')throw Error('Hidden sheets are not supported. Upload a workbook containing visible tabular sheets only.');
  const relationshipId=sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')??sheetNode.getAttribute('r:id')??'';
  const path=relationships.get(relationshipId);if(!path)throw Error('The XLSX worksheet relationship is invalid.');
  const sheet=parseXml(await requiredText(zip,path),'worksheet');
  if([...unsupportedSheetNodes].some(name=>elements(sheet,name).length))throw Error('Protected, merged, linked, drawn, table-based or other complex worksheet layouts are not supported.');
  if(elements(sheet,'f').length)throw Error('Spreadsheet formulas are not supported. Remove them before uploading the template.');
  const values:Record<number,Record<number,string>>={};let lastRow=1,lastColumn=0;
  for(const cell of elements(sheet,'c')){
   const reference=cell.getAttribute('r')??'',row=Number(reference.match(/\d+$/)?.[0]),column=columnNumber(reference);
   if(!Number.isInteger(row)||row<1||!column)throw Error('The XLSX contains an invalid cell reference.');
   lastRow=Math.max(lastRow,row);lastColumn=Math.max(lastColumn,column);
   const value=cellText(cell,shared);if(value)(values[row]??={})[column]=value;
  }
  if(lastRow>maxRows||lastColumn>maxColumns)throw Error(`Templates are limited to ${maxRows} rows and ${maxColumns} columns per sheet.`);
  sheets.push({name:sheetNode.getAttribute('name')??'',path,maxHeaderRow:Math.min(20,lastRow),maxColumn:lastColumn,values});
 }
 return{original,sheets};
}
export function templateColumns(template:SchedulingTemplate,sheetName:string,headerRow:number):SchedulingTemplateColumn[]{
 const sheet=template.sheets.find(value=>value.name===sheetName);if(!sheet)throw Error('Choose a valid worksheet.');
 if(!Number.isInteger(headerRow)||headerRow<1||headerRow>20)throw Error('Choose a header row from 1 to 20.');
 const columns:Array<SchedulingTemplateColumn>=[],seen=new Set<string>();
 for(let column=1;column<=sheet.maxColumn;column++){
  const header=(sheet.values[headerRow]?.[column]??'').trim();
  if(!header)continue;
  const normalized=header.toLocaleLowerCase();
  if(seen.has(normalized))throw Error('Template headers must be unique.');
  seen.add(normalized);columns.push({column,header});
 }
 if(!columns.length)throw Error('The selected row does not contain any headers.');
 if(Object.entries(sheet.values).some(([row,values])=>Number(row)>headerRow&&Object.values(values).some(value=>value.trim())))throw Error('The selected template sheet must contain headers only below the chosen header row. Existing data rows are not overwritten.');
 return columns;
}
export function validateTemplateMapping(columns:SchedulingTemplateColumn[],mapping:SchedulingTemplateMapping){
 const supported=new Set(schedulingReportFields.map(field=>field.key));
 const mapped=columns.map(column=>mapping[column.column]).filter((value):value is SchedulingReportField=>Boolean(value));
 if(!mapped.length)throw Error('Map at least one template column.');
 if(mapped.some(value=>!supported.has(value))||new Set(mapped).size!==mapped.length)throw Error('Each supported Scheduling field can be mapped once.');
}
export function mappedPreview(rows:SchedulingReportRow[],columns:SchedulingTemplateColumn[],mapping:SchedulingTemplateMapping,limit=10):string[][]{
 validateTemplateMapping(columns,mapping);
 return[
  columns.map(column=>column.header),
  ...rows.slice(0,limit).map(row=>columns.map(column=>mapping[column.column]?neutralizeSpreadsheetText(row[mapping[column.column] as SchedulingReportField]):'')),
 ];
}
export async function populateSchedulingTemplate(template:SchedulingTemplate,sheetName:string,headerRow:number,columns:SchedulingTemplateColumn[],mapping:SchedulingTemplateMapping,rows:SchedulingReportRow[]):Promise<ArrayBuffer>{
 validateTemplateMapping(columns,mapping);
 const selected=template.sheets.find(sheet=>sheet.name===sheetName);if(!selected)throw Error('The selected worksheet is unavailable.');
 const zip=await loadZip(template.original.slice(0)),document=parseXml(await requiredText(zip,selected.path),'worksheet'),sheetData=elements(document,'sheetData')[0];
 if(!sheetData)throw Error('The selected worksheet has no tabular cell area.');
 const namespace=document.documentElement.namespaceURI;
 const rowNodes=()=>elements(sheetData,'row');
 const getRow=(number:number)=>{
  let row=rowNodes().find(node=>Number(node.getAttribute('r'))===number);
  if(row)return row;
  row=document.createElementNS(namespace,'row');row.setAttribute('r',String(number));
  const next=rowNodes().find(node=>Number(node.getAttribute('r'))>number);sheetData.insertBefore(row,next??null);return row;
 };
 const reference=(column:number,row:number)=>{let value='',number=column;while(number){number--;value=String.fromCharCode(65+number%26)+value;number=Math.floor(number/26);}return `${value}${row}`;};
 for(let index=0;index<rows.length;index++)for(const column of columns){
  const field=mapping[column.column],value=field?neutralizeSpreadsheetText(rows[index][field]):'';if(!value)continue;
  const rowNumber=headerRow+index+1,row=getRow(rowNumber),cellReference=reference(column.column,rowNumber);
  let cell=elements(row,'c').find(node=>node.getAttribute('r')===cellReference);
  if(!cell){
   cell=document.createElementNS(namespace,'c');cell.setAttribute('r',cellReference);
   const headerCell=elements(sheetData,'c').find(node=>node.getAttribute('r')===reference(column.column,headerRow)),style=headerCell?.getAttribute('s');if(style)cell.setAttribute('s',style);
   const next=elements(row,'c').find(node=>columnNumber(node.getAttribute('r')??'')>column.column);row.insertBefore(cell,next??null);
  }
  while(cell.firstChild)cell.removeChild(cell.firstChild);
  cell.setAttribute('t','inlineStr');
  const inline=document.createElementNS(namespace,'is'),text=document.createElementNS(namespace,'t');text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');text.textContent=value;inline.appendChild(text);cell.appendChild(inline);
 }
 zip.file(selected.path,new XMLSerializer().serializeToString(document));
 return zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
}
