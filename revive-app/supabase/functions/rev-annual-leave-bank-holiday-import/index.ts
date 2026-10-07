import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {fetchOfficialHolidays, handleBankHolidayImport, ImportRefusal, importRefusals} from './bankHolidayImportBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, {global: {headers: {Authorization: authorization}}, auth: {persistSession: false, autoRefreshToken: false}});
Deno.serve(request => handleBankHolidayImport(request, {
 allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
 getUserId: async authorization => {
  const {data, error} = await caller(authorization).auth.getUser();
  return error ? null : data.user?.id ?? null;
 },
 canManage: async (authorization, workspaceId, userId) => {
  const {data, error} = await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  return !error && data?.status === 'active' && ['owner', 'admin'].includes(data.role);
 },
 fetchOfficial: fetchOfficialHolidays,
 now: () => new Date().toISOString(),
 execute: async input => {
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false, autoRefreshToken: false}});
  const {data, error} = await service.rpc('import_rev_annual_leave_bank_holidays', input);
  if (error) {
   const code = Object.entries(importRefusals).find(([message]) => error.code === 'P0001' && message === error.message)?.[1];
   if (code) throw new ImportRefusal(code);
   throw Error('Official holiday import unavailable');
  }
  return data;
 },
}));
