// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(), multiVersion:false, earlierEmpty:false}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{
  rpc:(...args:unknown[])=>mocks.rpc(...args),
  from:(table:string)=>{
    const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,limit:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='programme_hub_vocational_templates'?[{id:'template'}]:[{
        id:'version-3',template_id:'template',version:3,title:'Employment questionnaire',published_at:'2026-10-28T12:00:00Z',
        sections:[{id:'goals',title:'Employment goals',questions:[{id:'goal',label:'What work interests you?',type:'long_text',required:false,sensitive:false}]}],
      }, ...(mocks.multiVersion ? [{id:'version-1',template_id:'template',version:1,title:'Earlier questionnaire',published_at:'2026-10-01T12:00:00Z',
        sections:mocks.earlierEmpty?[]:[{id:'goals',title:'Employment goals',questions:[{id:'goal',label:'What work interests you?',type:'long_text',required:false,sensitive:false}]}]}] : [])],error:null}).then(resolve)};
    return query;
  },
}}));
import { VocationalStatusPanel } from '@/components/VocationalStatusPanel';
import { ParticipantVocationalAssessment } from '@/components/ParticipantVocationalAssessment';
const props={workspaceId:'workspace',programmeId:'programme',participantId:'participant'};
const status=(assessmentId:string,total=1,templateVersionId='version-3')=>({status:'in_progress',assessmentId,templateVersionId,answered:0,total,updatedAt:null,completedAt:null,updatedByUserId:null});
beforeEach(()=>{mocks.rpc.mockReset();mocks.multiVersion=false;mocks.earlierEmpty=false;});
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
  fireEvent.click(screen.getByRole('button',{name:'Open vocational profile'}));
  expect(await screen.findByText('0 of 1 questions answered (0%)')).toBeVisible();
  expect(screen.queryByText('Core questionnaire not available. Programme setup needs review.')).toBeNull();
  expect(screen.getByText(/Current questionnaire: 1 core question/)).toHaveTextContent('1 core question across 1 section');
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
    return{data:{...status(`assessment-${selected}`,1,selected),answered:1},error:null};
  });
  render(<ParticipantVocationalAssessment {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open vocational profile'}));
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
  fireEvent.click(screen.getByRole('button',{name:'Open vocational profile'}));
  await screen.findByText(/Current questionnaire: 1 core question/);
  fireEvent.click(screen.getByRole('button',{name:/Employment goals/}));
  expect(screen.getByLabelText('What work interests you?')).toHaveValue('Current saved answer');
  expect(selected).toBe('version-3');
  const opens=mocks.rpc.mock.calls.filter(([name])=>name==='rev_voc_assessment_draft');
  expect(opens.every(([,args])=>args.target_action==='open')).toBe(true);
  expect(opens.map(([,args])=>args.target_template_version_id)).toEqual(['version-3','version-1','version-3']);
});

it('does not label a legacy overview completion as the current questionnaire',async()=>{
  mocks.rpc.mockResolvedValue({data:{...status('old-assessment'),status:'completed'},error:null});
  render(<VocationalStatusPanel {...props} compact/>);
  expect(await screen.findByText('Current questionnaire status could not be verified.')).toBeVisible();
  expect(screen.queryByText('Current questionnaire: Completed')).toBeNull();
});

it('guides staff back to the current questionnaire when earlier history has no core questions, without requesting setup or changing answers',async()=>{
  mocks.multiVersion=true;mocks.earlierEmpty=true;let selected='';
  mocks.rpc.mockImplementation(async(name:string,args:{target_template_version_id?:string})=>{
    if(name==='rev_voc_assessment_draft'){
      selected=args.target_template_version_id!;
      return{data:{assessmentId:`assessment-${selected}`,version:1,status:'draft',answers:selected==='version-3'?{goal:'Current saved answer'}:{}},error:null};
    }
    return{data:status(`assessment-${selected}`,selected==='version-3'?1:0,selected),error:null};
  });
  render(<ParticipantVocationalAssessment {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open vocational profile'}));
  await screen.findByText('Current questionnaire: In progress');
  fireEvent.click(screen.getByText('Earlier questionnaires and saved answers',{selector:'summary'}));
  fireEvent.change(screen.getByLabelText('Published questionnaire version'),{target:{value:'version-1'}});
  expect(await screen.findByText('This earlier questionnaire contains no core employment questions. Select the current questionnaire to continue.')).toBeVisible();
  expect(await screen.findByText('Earlier questionnaire: In progress')).toBeVisible();
  expect(screen.queryByText(/Programme setup needs review|Ask your manager/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Copy setup request for manager'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Review programme questionnaire'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Mark completed'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Published questionnaire version'),{target:{value:'version-3'}});
  await screen.findByText('Current questionnaire: In progress');
  fireEvent.click(screen.getByRole('button',{name:/Employment goals/}));
  expect(screen.getByLabelText('What work interests you?')).toHaveValue('Current saved answer');
  expect(mocks.rpc.mock.calls.filter(([name])=>name==='rev_voc_assessment_draft').every(([,args])=>args.target_action==='open')).toBe(true);
  expect(mocks.rpc.mock.calls.some(([name])=>name==='rev_voc_assessment_complete')).toBe(false);
});

it('retains the setup warning for the current questionnaire with no core questions',async()=>{
  mocks.rpc.mockResolvedValue({data:status('assessment-3',0),error:null});
  render(<VocationalStatusPanel {...props} assessmentId="assessment-3" questionnaire={{templateVersionId:'version-3',title:'Employment questionnaire',version:3,isCurrent:true}}/>);
  expect(await screen.findByText('Core questionnaire not available. Programme setup needs review.')).toBeVisible();
});

it('identifies an unopened current questionnaire separately from an earlier completed assessment',async()=>{
  mocks.rpc.mockResolvedValue({data:{
    ...status('unused'),assessmentId:null,status:'not_started',
    questionnaire:{templateVersionId:'version-3',title:'Employment questionnaire',version:3},
    earlierCompletedAssessment:{assessmentId:'assessment-1',templateVersionId:'version-1',questionnaireTitle:'Earlier questionnaire',questionnaireVersion:1,completedAt:'2026-10-02T09:00:00Z'},
  },error:null});
  render(<VocationalStatusPanel {...props} compact/>);
  expect(await screen.findByText('Current questionnaire: Not started')).toBeVisible();
  expect(screen.getByText('Employment questionnaire - version 3')).toBeVisible();
  expect(screen.getByText(/Earlier completed assessment: Earlier questionnaire - version 1/)).toHaveTextContent('This does not complete the current questionnaire.');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith('rev_voc_assessment_status',expect.objectContaining({target_participant_id:'participant'}));
});

it('regression: older completed assessment plus newer incomplete questionnaire is labelled consistently in caseload and selected status',async()=>{
  const completedAt='2026-10-02T09:00:00Z';
  const earlier={status:'completed',assessmentId:'assessment-1',templateVersionId:'version-1',answered:1,total:1,updatedAt:completedAt,completedAt,updatedByUserId:null};
  const current={status:'in_progress',assessmentId:'assessment-3',templateVersionId:'version-3',answered:1,total:2,updatedAt:'2026-11-02T09:00:00Z',completedAt:null,updatedByUserId:null};
  mocks.rpc.mockImplementation(async(name:string,args:{target_assessment_id?:string})=>{
    if(name==='rev_voc_assessment_status')return{data:{...current,
      questionnaire:{templateVersionId:'version-3',title:'Employment questionnaire',version:3},
      earlierCompletedAssessment:{assessmentId:'assessment-1',templateVersionId:'version-1',questionnaireTitle:'Earlier questionnaire',questionnaireVersion:1,completedAt}},error:null};
    return{data:args.target_assessment_id==='assessment-1'?earlier:current,error:null};
  });
  render(<>
    <div data-testid="caseload"><VocationalStatusPanel {...props} compact/></div>
    <div data-testid="selected-current"><VocationalStatusPanel {...props} assessmentId="assessment-3" questionnaire={{templateVersionId:'version-3',title:'Employment questionnaire',version:3,isCurrent:true}}/></div>
    <div data-testid="selected-earlier"><VocationalStatusPanel {...props} assessmentId="assessment-1" questionnaire={{templateVersionId:'version-1',title:'Earlier questionnaire',version:1,isCurrent:false}}/></div>
  </>);
  const caseload=within(screen.getByTestId('caseload'));
  expect(await caseload.findByText('Current questionnaire: In progress')).toBeVisible();
  expect(caseload.getByText('Employment questionnaire - version 3')).toBeVisible();
  expect(caseload.getByText(/Earlier completed assessment: Earlier questionnaire - version 1/)).toHaveTextContent('This does not complete the current questionnaire.');
  expect(caseload.queryByText(/Current questionnaire: Completed/)).toBeNull();
  const selectedCurrent=within(screen.getByTestId('selected-current'));
  expect(await selectedCurrent.findByText('Current questionnaire: In progress')).toBeVisible();
  expect(selectedCurrent.getByText('1 of 2 questions answered (50%)')).toBeVisible();
  expect(selectedCurrent.getByText('Completed: Not completed')).toBeVisible();
  const selectedEarlier=within(screen.getByTestId('selected-earlier'));
  expect(await selectedEarlier.findByText('Earlier questionnaire: Completed')).toBeVisible();
  expect(selectedEarlier.getByText('Earlier questionnaire - version 1')).toBeVisible();
  expect(selectedEarlier.queryByText(/Current questionnaire/)).toBeNull();
  expect(mocks.rpc.mock.calls.some(([name])=>name==='rev_voc_assessment_complete'||name==='rev_voc_assessment_draft')).toBe(false);
});
