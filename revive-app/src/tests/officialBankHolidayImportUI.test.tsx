// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {OfficialBankHolidayImport} from '@/components/OfficialBankHolidayImport';
import {rememberAnnualLeaveAttempt,restoreAnnualLeaveAttempt,submitAnnualLeaveAttempt,type AnnualLeaveAttempt} from '@/services/annualLeave';

const workspaceId='11111111-1111-4111-8111-111111111111',workerId='22222222-2222-4222-8222-222222222222',previewId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444',userId='55555555-5555-4555-8555-555555555555';
const preview={action:'preview',workspaceId,workerId,previewId,calendarId:null,calendarName:'England and Wales',region:'england-and-wales',calendarYear:2026,holidays:[{date:'2026-01-01',title:"New Year's Day"}],conflicts:[],preserved:['2026-06-01: Company holiday'],additions:1,existing:0,source:'https://www.gov.uk/bank-holidays.json',fetchedAt:'2026-10-07T09:00:00Z'};
function fixture(invoke=vi.fn().mockResolvedValue({status:200,data:preview})){
 const onConfirm=vi.fn(),onLoading=vi.fn();
 const props={workspaceId,workerId,calendarId:null,year:'2026',disabled:false,invoke,onConfirm,onLoading};
 return{...render(<OfficialBankHolidayImport {...props}/>),props,invoke,onConfirm,onLoading};
}
afterEach(()=>{cleanup();window.sessionStorage.clear();});
describe('mounted official holiday review',()=>{
 it('loads server dates, shows provenance and manual entries, and only confirms after review',async()=>{
  const f=fixture();expect(screen.queryByRole('button',{name:'Confirm reviewed holidays'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(f.onLoading).toHaveBeenCalledWith(true);
  fireEvent.click(await screen.findByRole('button',{name:'Confirm reviewed holidays'}));
  expect(screen.getByText(/01\/01\/2026: New Year's Day/)).toBeInTheDocument();
  expect(screen.getByText('01/06/2026: Company holiday')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'GOV.UK'})).toHaveAttribute('href',preview.source);
  expect(f.onConfirm).toHaveBeenCalledWith(previewId);
  expect(f.invoke.mock.calls[0][1]).toEqual({action:'preview',workspaceId,workerId,calendarId:null,calendarYear:2026,region:'england-and-wales'});
  fireEvent.change(screen.getByRole('combobox',{name:'UK region'}),{target:{value:'scotland'}});
  expect(screen.queryByRole('button',{name:'Confirm reviewed holidays'})).not.toBeInTheDocument();
 });
 it('blocks conflicts, clears old reviews on failed reload, and never confirms missing years',async()=>{
  const invoke=vi.fn().mockResolvedValueOnce({status:200,data:{...preview,conflicts:['2026-01-01: manual date preserved']}}).mockRejectedValueOnce(Error('unavailable'));
  const f=fixture(invoke);fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  expect(await screen.findByRole('button',{name:'Confirm reviewed holidays'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed or confirmed');
  expect(screen.queryByRole('button',{name:'Confirm reviewed holidays'})).not.toBeInTheDocument();
  expect(f.onConfirm).not.toHaveBeenCalled();
 });
 it('rejects malformed and cross-tenant previews and supports all regions',async()=>{
  for(const region of['england-and-wales','scotland','northern-ireland']){
   const f=fixture(vi.fn().mockResolvedValue({status:200,data:{...preview,region,workspaceId:userId}}));
   fireEvent.change(screen.getByRole('combobox',{name:'UK region'}),{target:{value:region}});
   fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
   await screen.findByRole('alert');expect(f.onConfirm).not.toHaveBeenCalled();expect(f.invoke.mock.calls[0][1].region).toBe(region);cleanup();
  }
 });
 it('shows loading and ignores a response after unmount',async()=>{
  let resolve!:(value:unknown)=>void;const response=new Promise(done=>{resolve=done;});
  const f=fixture(vi.fn().mockReturnValue(response));
  fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  expect(screen.getByRole('status')).toHaveTextContent('Loading official dates');
  expect(screen.getByRole('combobox',{name:'UK region'})).toBeDisabled();
  f.unmount();await act(async()=>{resolve({status:200,data:preview});await response;});
  expect(f.onConfirm).not.toHaveBeenCalled();expect(f.onLoading).toHaveBeenLastCalledWith(false);
 });
 it('preserves exact confirmation retry without fetching again',async()=>{
  const attempt:AnnualLeaveAttempt={operation:'import',workspaceId,workerId,requestId,body:{action:'confirm',workspaceId,workerId,requestId,previewId}};
  rememberAnnualLeaveAttempt(window.sessionStorage,userId,attempt);
  const invoke=vi.fn().mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce({status:200,data:{action:'confirm',workspaceId,workerId,requestId,previewId,calendarId:previewId,revision:1,confirmedRevision:1,source:preview.source,fetchedAt:preview.fetchedAt}});
  await expect(submitAnnualLeaveAttempt(attempt,invoke)).rejects.toThrow();
  const restored=restoreAnnualLeaveAttempt(window.sessionStorage,workspaceId,userId)!;
  await submitAnnualLeaveAttempt(restored,invoke);
  expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1]);
  expect(invoke.mock.calls[1][0]).toBe('rev-annual-leave-bank-holiday-import');
 });
 it('disables requests when the parent has a pending mutation',async()=>{
  const f=fixture();f.rerender(<OfficialBankHolidayImport {...f.props} disabled/>);
  fireEvent.click(screen.getByRole('button',{name:'Load official dates'}));
  await waitFor(()=>expect(f.invoke).not.toHaveBeenCalled());
 });
});
