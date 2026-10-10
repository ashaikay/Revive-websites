import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCompaniesHouseEmployers } from './companiesHouseEmployerDiscovery.ts';

test('builds an authenticated advanced search and normalises registry evidence', async () => {
  let url = '', authorization = '';
  const results = await discoverCompaniesHouseEmployers(
    { location: 'Birmingham / West Midlands', sectors: ['construction', 'post_office_branches'], excludeTerms: ['barbering'] },
    'server-key',
    async (input, init) => {
      url = input;
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ items: [
        { company_number: '12345678', company_name: 'MIDLAND BUILDERS LTD', company_status: 'active', sic_codes: ['41202'], registered_office_address: { address_line_1: '1 TEST STREET', locality: 'BIRMINGHAM', region: 'WEST MIDLANDS', postal_code: 'B1 1AA' } },
        { company_number: '87654321', company_name: 'BARBERING GROUP LTD', company_status: 'active', sic_codes: ['96020'], registered_office_address: {} },
      ] }), { status: 200 });
    },
    new Date('2026-10-10T00:00:00.000Z'),
  );
  assert.match(url, /\/advanced-search\/companies\?/);
  assert.match(url, /location=Birmingham/);
  assert.match(url, /sic_codes=/);
  assert.equal(authorization, `Basic ${btoa('server-key:')}`);
  assert.equal(results.length, 1);
  assert.equal(results[0].sourceIdentity, '12345678');
  assert.match(results[0].sector, /Construction/);
  assert.ok(results[0].evidence.some((item) => item.kind === 'unknown' && /Vacancies and contacts/.test(item.label)));
  assert.ok(!JSON.stringify(results).includes('BARBERING GROUP'));
});
