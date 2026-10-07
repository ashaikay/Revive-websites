import {useEffect, useRef, useState} from 'react';
import type {AnnualLeaveInvoke} from '@/services/annualLeave';

const source = 'https://www.gov.uk/bank-holidays.json';
const regions = [
 {value: 'england-and-wales', name: 'England and Wales', codes: ['GB-EAW', 'GB-ENG', 'GB-WLS']},
 {value: 'scotland', name: 'Scotland', codes: ['GB-SCT']},
 {value: 'northern-ireland', name: 'Northern Ireland', codes: ['GB-NIR']},
];
interface Preview {
 action: 'preview'; workspaceId: string; workerId: string; previewId: string; calendarId: string | null;
 calendarName: string; region: string; calendarYear: number; source: string; fetchedAt: string;
 holidays: {date: string; title: string}[]; conflicts: string[]; preserved: string[]; additions: number; existing: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validatePreview(value: unknown, workspaceId: string, workerId: string, region: string, year: number): Preview {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid preview');
 const row = value as Record<string, unknown>;
 if (row.action !== 'preview' || row.workspaceId !== workspaceId || row.workerId !== workerId ||
  row.region !== region || row.calendarYear !== year || typeof row.previewId !== 'string' || !uuid.test(row.previewId) ||
  !(row.calendarId === null || typeof row.calendarId === 'string' && uuid.test(row.calendarId)) ||
  typeof row.calendarName !== 'string' || !row.calendarName || row.source !== source ||
  typeof row.fetchedAt !== 'string' || !Number.isFinite(Date.parse(row.fetchedAt)) ||
  !Number.isSafeInteger(row.additions) || Number(row.additions) < 0 || !Number.isSafeInteger(row.existing) || Number(row.existing) < 0 ||
  !Array.isArray(row.conflicts) || row.conflicts.some(item => typeof item !== 'string') ||
  !Array.isArray(row.preserved) || row.preserved.some(item => typeof item !== 'string') ||
  !Array.isArray(row.holidays) || row.holidays.length < 1 || row.holidays.length > 100) throw Error('Invalid preview');
 const dates = new Set<string>();
 for (const holiday of row.holidays) {
  if (!holiday || typeof holiday !== 'object' || typeof holiday.date !== 'string' ||
   !/^\d{4}-\d{2}-\d{2}$/.test(holiday.date) || Number(holiday.date.slice(0, 4)) !== year ||
   !Number.isFinite(Date.parse(holiday.date + 'T00:00:00Z')) ||
   new Date(holiday.date + 'T00:00:00Z').toISOString().slice(0, 10) !== holiday.date ||
   dates.has(holiday.date) || typeof holiday.title !== 'string' || !holiday.title.trim()) throw Error('Invalid preview');
  dates.add(holiday.date);
 }
 return row as unknown as Preview;
}
interface Props {
 workspaceId: string; workerId: string; calendarId: string | null; regionCode?: string; year: string;
 disabled: boolean; invoke: AnnualLeaveInvoke; onLoading(loading: boolean): void; onConfirm(previewId: string): void;
}
export function OfficialBankHolidayImport({workspaceId, workerId, calendarId, regionCode, year, disabled, invoke, onLoading, onConfirm}: Props) {
 const [region, setRegion] = useState(regions.find(value => value.codes.includes(regionCode ?? ''))?.value ?? regions[0].value);
 const [selectedYear, setSelectedYear] = useState(year);
 const [preview, setPreview] = useState<Preview | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState('');
 const sequence = useRef(0);
 const mounted = useRef(true);
 const loadingRef = useRef(false);
 useEffect(() => {
  mounted.current = true;
  return () => {
   mounted.current = false; sequence.current++;
   if (loadingRef.current) onLoading(false);
  };
 }, []);
 const load = async () => {
  if (disabled || loadingRef.current) return;
  const calendarYear = Number(selectedYear);
  setPreview(null); setError('');
  if (!/^\d{4}$/.test(selectedYear) || calendarYear < 1000 || calendarYear > 9999) {
   setError('Choose a valid four-digit year.'); return;
  }
  const current = ++sequence.current;
  loadingRef.current = true; setLoading(true); onLoading(true);
  try {
   const response = await invoke('rev-annual-leave-bank-holiday-import', {
    action: 'preview', workspaceId, workerId, calendarYear, region,
    calendarId: regions.find(value => value.value === region)?.codes.includes(regionCode ?? '') ? calendarId : null,
   });
   if (!mounted.current || current !== sequence.current) return;
   if (response.status !== 200) throw Error('Official dates unavailable');
   setPreview(validatePreview(response.data, workspaceId, workerId, region, calendarYear));
  } catch {
   if (mounted.current && current === sequence.current) setError('Official dates could not be loaded or this year is unavailable. Nothing was changed or confirmed. Try another year or try again later.');
  } finally {
   if (mounted.current && current === sequence.current) {loadingRef.current = false; setLoading(false); onLoading(false);}
  }
 };
 const fieldClass = 'input-field bg-white text-neutral-900 disabled:bg-neutral-100';
 return <section className="mt-4" aria-label="Official UK bank holidays">
  <h5 className="font-medium">Load official UK bank holidays</h5>
  <p className="text-sm">Choose a region and year, load GOV.UK dates, then review and confirm. Manual entries are preserved. Existing leave and balances never change.</p>
  <div className="grid gap-4 mt-3 sm:grid-cols-2">
   <label className="grid gap-1 text-sm font-medium">UK region
    <select className={fieldClass} value={region} disabled={disabled || loading} onChange={event => {setRegion(event.target.value); setPreview(null); setError('');}}>
     {regions.map(value => <option key={value.value} value={value.value}>{value.name}</option>)}
    </select>
   </label>
   <label className="grid gap-1 text-sm font-medium">Official holiday year
    <input className={fieldClass} type="number" min="1000" max="9999" value={selectedYear} disabled={disabled || loading} onChange={event => {setSelectedYear(event.target.value); setPreview(null); setError('');}} />
   </label>
  </div>
  <button type="button" className="btn-secondary mt-3" disabled={disabled || loading} onClick={() => void load()}>Load official dates</button>
  {loading && <p role="status">Loading official dates from GOV.UK. Nothing is confirmed yet.</p>}
  {error && <p role="alert" className="mt-3">{error}</p>}
  {preview && <div className="mt-4">
   <h5 className="font-medium">Review {preview.calendarYear} holidays</h5>
   <p>Calendar: {preview.calendarName}. Confirming assigns this calendar to this worker. Shared calendar changes affect all assigned workers.</p>
   <p className="text-sm">Source: <a href={preview.source} target="_blank" rel="noreferrer">GOV.UK</a>. Fetched: {new Date(preview.fetchedAt).toLocaleString('en-GB')}.</p>
   <ul>{preview.holidays.map(holiday => <li key={holiday.date}>{holiday.date}: {holiday.title}</li>)}</ul>
   <p>{preview.additions} dates to add; {preview.existing} already imported. Review the entire list before confirming completeness.</p>
   {preview.preserved.length > 0 && <><p>Manual dates kept in this year:</p><ul>{preview.preserved.map(item => <li key={item}>{item}</li>)}</ul></>}
   {preview.conflicts.length > 0 && <div role="alert"><p>Conflicts: nothing will be overwritten or imported. Resolve these entries in manual calendar controls, then load again.</p><ul>{preview.conflicts.map(item => <li key={item}>{item}</li>)}</ul></div>}
   <button type="button" className="btn-primary mt-3" disabled={disabled || loading || preview.conflicts.length > 0} onClick={() => onConfirm(preview.previewId)}>Confirm reviewed holidays</button>
  </div>}
 </section>;
}
