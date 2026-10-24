// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SchedulingReportingPanel} from '@/components/SchedulingReportingPanel';
import type {PlannerData} from '@/services/schedulingPlanner';

const worker='11111111-1111-4111-8111-111111111111';
const data:PlannerData={
 workers:[{id:worker,name:'Ricki',active:true,skills:[]}],
 jobs:[{id:'22222222-2222-4222-8222-222222222222',title:'Support shift',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',timezone:'Europe/London',location:'Birmingham',skills:[],skillRequirementMode:'all',count:1,status:'open'}],
 assignments:[{id:'33333333-3333-4333-8333-333333333333',workerId:worker,jobId:'22222222-2222-4222-8222-222222222222',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',status:'active'}],
 patterns:[],leave:[],
};

describe('Scheduling reporting controls',()=>{
 beforeEach(()=>{vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);});
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
 it('distinguishes exports from reports and requires a preview before report download',()=>{
  render(<SchedulingReportingPanel data={data} startDate="2026-10-05" endDate="2026-10-11" timezone="Europe/London" workerId="" location="" periodLabel="WEEK" stale={false}/>);
  fireEvent.click(screen.getByText('Schedule exports and reporting'));
  expect(screen.getByRole('button',{name:'DOWNLOAD SELECTED WEEK CSV'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'DOWNLOAD STANDARD REPORT CSV'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'GENERATE REPORT PREVIEW'}));
  expect(screen.getByText('1 report row generated. Blank cells mean that the selected record type has no supported value for that field.')).toBeVisible();
  expect(screen.getByRole('button',{name:'DOWNLOAD STANDARD REPORT CSV'})).toBeVisible();
  expect(screen.getByRole('cell',{name:'Support shift'})).toBeVisible();
 });

 it('applies worker and location filters and does not present stale data as a report',()=>{
  const {rerender}=render(<SchedulingReportingPanel data={data} startDate="2026-10-05" endDate="2026-10-11" timezone="Europe/London" workerId="" location="" periodLabel="WEEK" stale={false}/>);
  fireEvent.click(screen.getByText('Schedule exports and reporting'));
  fireEvent.change(screen.getByLabelText('Report location'),{target:{value:'Birmingham'}});
  fireEvent.click(screen.getByRole('button',{name:'GENERATE REPORT PREVIEW'}));
  expect(screen.getByText(/1 report row generated/)).toBeVisible();
  rerender(<SchedulingReportingPanel data={data} startDate="2026-10-05" endDate="2026-10-11" timezone="Europe/London" workerId="" location="" periodLabel="WEEK" stale/>);
  expect(screen.getByRole('button',{name:'GENERATE REPORT PREVIEW'})).toBeDisabled();
 });
});
