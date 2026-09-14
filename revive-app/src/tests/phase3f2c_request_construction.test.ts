import { describe, expect, it } from 'vitest';
import { buildCompaniesHouseRequest } from '../../supabase/functions/rev-business-verify/request';

describe('Phase 3F.2C Companies House request construction', () => {
  it('builds a profile GET with no body and API_KEY colon Basic Auth', () => {
    const request = buildCompaniesHouseRequest({ companyNumber: '00000006' }, 'test_key');
    const authorization = new Headers(request.init.headers).get('Authorization') ?? '';
    expect(request.url).toBe('https://api.company-information.service.gov.uk/company/00000006');
    expect(request.init.method).toBe('GET');
    expect(request.init.body).toBeUndefined();
    expect(atob(authorization.replace('Basic ', ''))).toBe('test_key:');
    expect(authorization.startsWith('Basic ')).toBe(true);
    expect(authorization).not.toContain('Bearer');
    expect(authorization).not.toContain('test_key');
  });

  it('builds a search GET with only documented query parameters', () => {
    const request = buildCompaniesHouseRequest({ businessName: 'A&B Services / Birmingham' }, ' test_key ');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/search/companies');
    expect(url.searchParams.get('q')).toBe('A&B Services / Birmingham');
    expect(url.searchParams.get('items_per_page')).toBe('20');
    expect([...url.searchParams.keys()].sort()).toEqual(['items_per_page', 'q']);
    expect(request.init.method).toBe('GET');
    expect(request.init.body).toBeUndefined();
    expect(new Headers(request.init.headers).get('apikey')).toBeNull();
    expect(new Headers(request.init.headers).get('Authorization')).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
  });

  it('rejects an empty trimmed API key without constructing a request', () => {
    expect(() => buildCompaniesHouseRequest({ companyNumber: '00000006' }, ' \n\t ')).toThrow(/empty/);
  });
});
