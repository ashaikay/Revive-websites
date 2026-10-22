// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import JSZip from 'jszip';
import {
 buildSchedulingReportRows,
 csvText,
 inspectSchedulingTemplate,
 mappedPreview,
 populateSchedulingTemplate,
 standardReportMatrix,
 templateColumns,
 type SchedulingTemplateMapping,
} from '@/services/schedulingReporting';
import type {PlannerData} from '@/services/schedulingPlanner';

const workerOne='11111111-1111-4111-8111-111111111111',workerTwo='22222222-2222-4222-8222-222222222222';
const data:PlannerData={
 workers:[{id:workerOne,name:'=Ricki',active:true,skills:[]},{id:workerTwo,name:'Sam',active:false,skills:[]}],
 jobs:[
  {id:'33333333-3333-4333-8333-333333333333',title:'Support shift',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',timezone:'Europe/London',location:'Birmingham',skills:[],skillRequirementMode:'all',count:1,status:'open'},
  {id:'44444444-4444-4444-8444-444444444444',title:'Cancelled shift',startAt:'2026-10-10T08:00:00.000Z',endAt:'2026-10-10T11:00:00.000Z',timezone:'Europe/London',location:'Coventry',skills:[],skillRequirementMode:'all',count:1,status:'cancelled'},
 ],
 assignments:[
  {id:'55555555-5555-4555-8555-555555555555',workerId:workerOne,jobId:'33333333-3333-4333-8333-333333333333',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',status:'active'},
  {id:'66666666-6666-4666-8666-666666666666',workerId:workerTwo,jobId:'44444444-4444-4444-8444-444444444444',startAt:'2026-10-10T08:00:00.000Z',endAt:'2026-10-10T11:00:00.000Z',status:'cancelled'},
 ],
 patterns:[],
 leave:[{id:'77777777-7777-4777-8777-777777777777',workerId:workerOne,startAt:'2026-10-11T08:00:00.000Z',endAt:'2026-10-11T17:00:00.000Z',category:'sickness',status:'active'}],
};
const options={startDate:'2026-10-05',endDate:'2026-10-11',timezone:'Europe/London',workerIds:[],location:'',status:'all' as const};

async function templateFile(extra:''|'formula'|'existing'=''){
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Organisation Report" sheetId="1" r:id="rId1"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
 const second=extra==='formula'?'<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>':extra==='existing'?'<row r="2"><c r="A2" t="inlineStr"><is><t>existing row</t></is></c></row>':'';
 zip.file('xl/worksheets/sheet1.xml',`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Person</t></is></c><c r="B1" t="inlineStr"><is><t>Shift</t></is></c><c r="C1" t="inlineStr"><is><t>Unsupported field</t></is></c></row>${second}</sheetData></worksheet>`);
 const bytes=await zip.generateAsync({type:'arraybuffer'});
 return{name:'organisation-report.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.slice(0)};
}

describe('Scheduling reporting',()=>{
 it('maps authorised schedule rows with filters, local timezone values and non-medical absence categories',()=>{
  const rows=buildSchedulingReportRows(data,options);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({record_type:'Assignment',worker:'=Ricki',job:'Support shift',date:'2026-10-09',local_start:'09:00',timezone:'Europe/London'});
  expect(rows).toContainEqual(expect.objectContaining({record_type:'Absence',absence_category:'Sickness'}));
  expect(JSON.stringify(rows)).not.toMatch(/diagnos|medical/i);
  expect(buildSchedulingReportRows(data,{...options,workerIds:[workerOne],location:'Birmingham',status:'current'})).toHaveLength(1);
  expect(buildSchedulingReportRows(data,{...options,status:'cancelled'})).toEqual([expect.objectContaining({worker:'Sam',assignment_status:'cancelled'})]);
 });

 it('leaves unsupported record fields blank and neutralises spreadsheet formulas',()=>{
  const rows=buildSchedulingReportRows(data,options),matrix=standardReportMatrix(rows);
  const workerIndex=matrix[0].indexOf('Worker'),absenceIndex=matrix[0].indexOf('Absence category');
  expect(csvText(matrix)).toContain("'=Ricki");
  expect(matrix[1][absenceIndex]).toBe('');
  expect(matrix[1][workerIndex]).toBe('=Ricki');
 });

 it('inspects a bounded header-only XLSX, maps columns and preserves the original while adding a report sheet',async()=>{
  const file=await templateFile(),template=await inspectSchedulingTemplate(file);
  const columns=templateColumns(template,template.sheets[0].name,1);
  const mapping:SchedulingTemplateMapping={1:'worker',2:'job',3:''};
  expect(mappedPreview(buildSchedulingReportRows(data,options),columns,mapping)[1]).toEqual(["'=Ricki",'Support shift','']);
  const output=await populateSchedulingTemplate(template,template.sheets[0].name,1,columns,mapping,buildSchedulingReportRows(data,options));
  expect(new Uint8Array(template.original)).toEqual(new Uint8Array(await file.arrayBuffer()));
  const generated=await JSZip.loadAsync(output),sheet=await generated.file('xl/worksheets/sheet1.xml')!.async('text');
  expect(sheet).toContain("'=Ricki");
  expect(sheet).toContain('Support shift');
  expect(sheet).not.toContain('r="C2"');
 });

 it('rejects malformed, formula-bearing and non-header-only workbooks clearly',async()=>{
  await expect(inspectSchedulingTemplate({name:'bad.xlsx',size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer})).rejects.toThrow(/malformed|encrypted|password/i);
  const formula=await templateFile('formula');
  await expect(inspectSchedulingTemplate(formula)).rejects.toThrow(/formulas/i);
  const existing=await templateFile('existing');
  const inspected=await inspectSchedulingTemplate(existing);
  expect(()=>templateColumns(inspected,inspected.sheets[0].name,1)).toThrow(/headers only|not overwritten/i);
 });

 it('keeps reporting read-only and relies on the paginated planner boundary',()=>{
  const component=readFileSync(resolve('src/components/SchedulingReportingPanel.tsx'),'utf8');
  const planner=readFileSync(resolve('src/services/schedulingPlanner.ts'),'utf8');
  expect(component).not.toMatch(/supabaseClient|functions\.invoke|\.insert\(|\.update\(|\.delete\(/);
  expect(planner).toContain("throw Error('Planner data exceeds supported limit; no partial schedule shown')");
  expect(planner).toContain("r.workspace_id!==ws");
 });
});
