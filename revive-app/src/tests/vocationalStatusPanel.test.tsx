// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(), multiVersion:false}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{
  rpc:(...args:unknown[])=>mocks.rpc(...args),
  from:(table:string)=>{
    const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,limit:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='programme_hub_vocational_templates'?[{id:'template'}]:[{
        id:'version-3',template_id:'template',version:3,title:'Employment questionnaire',published_at:'2026-10-28T12:00:00Z',
        sections:[{id:'goals',title:'Employment goals',questions:[{id:'goal',label:'What work interests you?',type:'long_text',required:false,sensitive:false}]}],
      }, ...(mocks.multiVersion ? [{id:'version-1',template_id:'template',version:1,title:'Earlier questionnaire',published_at:'2026-10-01T12:00:00Z',
        sections:[{id:'goals',title:'Employment goals',questions:[{id:'goal',label:'What work interests you?',type:'long_text',required:false,sensitive:false}]}]}] : [])],error:null}).then(resolve)};
    return query;
  },
}}));
import { VocationalStatusPanel } from '@/components/VocationalStatusPanel';
import { ParticipantVocationalAssessment } from '@/components/ParticipantVocationalAssessment';
const props={workspaceId:'workspace',programmeId:'programme',participantId:'participant'};
const status=(assessmentId:string,total=1)=>({status:'in_progress',assessmentId,answered:0,total,updatedAt:null,completedAt:null,updatedByUserId:null});
beforeEach(()=>{mocks.rpc.mockReset();mocks.multiVersion=false;});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('reads status after the selected assessment opens, instead of retaining an older zero-question result',async()=>{
  let opened=false;
  mocks.rpc.mockImplementation(async(name:string)=>{
    if(name==='rev_voc_assessment_draft'){
      opened=true;return{data:{assessmentId:'assessment-3',version:1,status:'draft',answers:{}},error:null};
    }
    return{data:opened?status('assessment-3'):status('old-assessment',0),error:null};
  });
  render(<ParticipantVocationalAssessment {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
  expect(await screen.findByText('0 of 1 questions answered (0%)')).toBeVisible();
  expect(screen.queryByText('Core questionnaire not available. Programme setup needs review.')).toBeNull();
  expect(screen.getByText(/Current questionnaire:/)).toHaveTextContent('1 core question across 1 section');
  expect(screen.queryByText(/newer draft questionnaire/)).toBeNull();
  expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual(['rev_voc_assessment_draft','rev_voc_assessment_selected_status']);
});
it('does not display another assessment status as the selected version status',async()=>{
  mocks.rpc.mockResolvedValue({data:status('old-assessment',0),error:null});
  render(<VocationalStatusPanel {...props} assessmentId="assessment-3"/>);
  expect(await screen.findByText(/Saved status for this questionnaire could not be verified/)).toBeVisible();
  expect(screen.queryByText('Core questionnaire not available. Programme setup needs review.')).toBeNull();
  expect(mocks.rpc).toHaveBeenCalledWith('rev_voc_assessment_selected_status', expect.objectContaining({target_assessment_id:'assessment-3'}));
});
it('suppresses an older status reply after the assessment selection changes',async()=>{
  let resolve!:(value:unknown)=>void;
  mocks.rpc.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  const view=render(<VocationalStatusPanel {...props} assessmentId="old-assessment"/>);
  mocks.rpc.mockResolvedValue({data:status('assessment-3'),error:null});
  view.rerender(<VocationalStatusPanel {...props} assessmentId="assessment-3"/>);
  await screen.findByText('0 of 1 questions answered (0%)');
  await act(async()=>resolve({data:status('old-assessment',0),error:null}));
  expect(screen.getByText('0 of 1 questions answered (0%)')).toBeVisible();
  expect(screen.queryByText(/could not be verified/)).toBeNull();
});
it('reports transport failure without presenting an empty questionnaire',async()=>{
  mocks.rpc.mockRejectedValue(new Error('offline'));
  render(<VocationalStatusPanel {...props} assessmentId="assessment-3"/>);
  expect(await screen.findByText('Status unavailable')).toBeVisible();
  expect(screen.queryByText(/Core questionnaire not available/)).toBeNull();
});

it('opens the current questionnaire automatically while keeping earlier saved answers in history',async()=>{
  mocks.multiVersion=true;let selected='';
  mocks.rpc.mockImplementation(async(name:string,args:{target_template_version_id?:string})=>{
    if(name==='rev_voc_assessment_draft'){
      selected=args.target_template_version_id!;
      return{data:{assessmentId:`assessment-${selected}`,version:1,status:'draft',answers:{goal:selected==='version-3'?'Current saved answer':'Earlier saved answer'}},error:null};
    }
    return{data:{...status(`assessment-${selected}`),answered:1},error:null};
  });
  render(<ParticipantVocationalAssessment {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
  await screen.findByText('1 of 1 questions answered (100%)');
  expect(selected).toBe('version-3');
  const history=screen.getByText('Earlier questionnaires and saved answers',{selector:'summary'});
  expect(history.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(history);
  fireEvent.change(screen.getByLabelText('Published questionnaire version'),{target:{value:'version-1'}});
  await screen.findByText(/Earlier questionnaire: 1 core question/);
  fireEvent.click(screen.getByRole('button',{name:/Employment goals/}));
  expect(screen.getByLabelText('What work interests you?')).toHaveValue('Earlier saved answer');
  fireEvent.click(screen.getByRole('button',{name:'Close profile'}));
  fireEvent.click(screen.getByRole('button',{name:'Open profile'}));
  await screen.findByText(/Current questionnaire: 1 core question/);
  fireEvent.click(screen.getByRole('button',{name:/Employment goals/}));
  expect(screen.getByLabelText('What work interests you?')).toHaveValue('Current saved answer');
  expect(selected).toBe('version-3');
  const opens=mocks.rpc.mock.calls.filter(([name])=>name==='rev_voc_assessment_draft');
  expect(opens.every(([,args])=>args.target_action==='open')).toBe(true);
  expect(opens.map(([,args])=>args.target_template_version_id)).toEqual(['version-3','version-1','version-3']);
});
