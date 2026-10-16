import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';
const folder=new URL('../../supabase/migrations/',import.meta.url);
const files=readdirSync(folder).filter(name=>name.endsWith('.sql')).sort();
const source=files.map(name=>readFileSync(new URL(name,folder),'utf8')).join('\n');
const modules=readFileSync(new URL('20261016040000_rev_workspace_module_access.sql',folder),'utf8');
it('binds every module policy to an existing workspace-scoped table column',()=>{
 const definitions=new Map<string,string>();
 for(const match of source.matchAll(/create table(?: if not exists)? public\.(\w+)\s*\(([\s\S]*?)\n\);/gi))definitions.set(match[1],match[2]);
 const policies=[...modules.matchAll(/create policy rev_module_access_guard on public\.(\w+)[^;]+;/g)];
 expect(policies.length).toBeGreaterThan(50);
 for(const policy of policies){
  expect(definitions.has(policy[1]),`Missing table definition: ${policy[1]}`).toBe(true);
  expect(definitions.get(policy[1]),`Missing workspace_id on ${policy[1]}`).toMatch(/\bworkspace_id\s+uuid\b/i);
 }
});
it('preserves the backend-only singleton meeting gate without inventing tenant columns',()=>{
 expect(modules).not.toMatch(/create policy\s+\w+\s+on public\.rev_meeting_provider_gate/i);
 expect(source).toMatch(/revoke all on public\.rev_meeting_provider_gate from public, anon, authenticated/);
 expect(source).toMatch(/grant select on public\.rev_meeting_provider_gate to service_role/);
});
