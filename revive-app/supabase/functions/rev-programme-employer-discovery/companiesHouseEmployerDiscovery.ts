export type DiscoveryFilters = {
  location: string;
  sectors: string[];
  excludeTerms: string[];
};

export type DiscoveryResult = {
  sourceIdentity: string;
  name: string;
  sector: string;
  location: string;
  address: string;
  sourceUrl: string;
  retrievedAt: string;
  evidence: Array<{ kind: 'verified_fact' | 'unknown'; label: string; value: string }>;
};

export class CompaniesHouseDiscoveryError extends Error {
  readonly code: 'provider_authentication' | 'provider_rate_limited' | 'provider_unavailable' | 'invalid_response';
  constructor(code: 'provider_authentication' | 'provider_rate_limited' | 'provider_unavailable' | 'invalid_response') {
    super(code);
    this.code = code;
  }
}

const sectorCodes: Record<string, string[]> = {
  construction: ['41100', '41201', '41202', '42110', '42120', '42130', '42210', '42220', '42910', '42990', '43110', '43120', '43210', '43220', '43290', '43310', '43320', '43330', '43341', '43342', '43390', '43910', '43991', '43999'],
  retail: ['47110', '47190', '47210', '47220', '47230', '47240', '47250', '47260', '47290', '47300', '47410', '47421', '47429', '47430', '47510', '47520', '47530', '47540', '47591', '47599', '47610', '47620', '47630', '47640', '47650', '47710', '47721', '47722', '47730', '47741', '47749', '47750', '47760', '47770', '47781', '47782', '47789', '47791', '47799', '47810', '47820', '47890', '47910', '47990'],
  warehousing_logistics: ['49410', '49420', '49500', '52101', '52102', '52103', '52219', '52220', '52241', '52242', '52243', '52290'],
  traffic_management: ['42110', '52219', '52290'],
  rail_train: ['42120', '49100', '49200', '52212'],
  royal_mail_postal: ['53100', '53201', '53202'],
  post_office_branches: ['53100'],
};

const sectorLabels: Record<string, string> = {
  construction: 'Construction',
  retail: 'Retail',
  warehousing_logistics: 'Warehousing and logistics',
  traffic_management: 'Traffic management',
  rail_train: 'Rail and train-related work',
  royal_mail_postal: 'Royal Mail and postal delivery',
  post_office_branches: 'Post Office branch roles',
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export async function discoverCompaniesHouseEmployers(
  filters: DiscoveryFilters,
  apiKey: string,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<DiscoveryResult[]> {
  const sicCodes = [...new Set(filters.sectors.flatMap((sector) => sectorCodes[sector] ?? []))];
  const query = new URLSearchParams({
    location: filters.location,
    sic_codes: sicCodes.join(','),
    company_status: 'active',
    size: '50',
  });
  let response: Response;
  try {
    response = await fetcher(`https://api.company-information.service.gov.uk/advanced-search/companies?${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${apiKey}:`)}`,
        Accept: 'application/json',
      },
    });
  } catch {
    throw new CompaniesHouseDiscoveryError('provider_unavailable');
  }
  if (response.status === 401 || response.status === 403) throw new CompaniesHouseDiscoveryError('provider_authentication');
  if (response.status === 429) throw new CompaniesHouseDiscoveryError('provider_rate_limited');
  if (!response.ok) throw new CompaniesHouseDiscoveryError('provider_unavailable');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CompaniesHouseDiscoveryError('invalid_response');
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new CompaniesHouseDiscoveryError('invalid_response');
  }
  const retrievedAt = now.toISOString();
  const exclusions = filters.excludeTerms.map((value) => value.toLowerCase());
  return (payload as { items: unknown[] }).items.flatMap((item): DiscoveryResult[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const sourceIdentity = stringValue(raw.company_number);
    const name = stringValue(raw.company_name || raw.title);
    const status = stringValue(raw.company_status);
    if (!sourceIdentity || !name || !status || exclusions.some((term) => name.toLowerCase().includes(term))) return [];
    const addressValue = raw.registered_office_address || raw.address;
    const address = addressValue && typeof addressValue === 'object' ? addressValue as Record<string, unknown> : {};
    const addressParts = ['address_line_1', 'address_line_2', 'locality', 'region', 'postal_code', 'country']
      .map((key) => stringValue(address[key])).filter(Boolean);
    const registeredAddress = addressParts.join(', ');
    const location = [stringValue(address.locality), stringValue(address.region), stringValue(address.postal_code)].filter(Boolean).join(', ');
    const itemCodes = stringArray(raw.sic_codes);
    const matchedSectors = filters.sectors.filter((sector) => (sectorCodes[sector] ?? []).some((code) => itemCodes.includes(code)));
    const sector = matchedSectors.map((key) => sectorLabels[key]).join('; ') || 'Sector not confirmed by selected SIC filters';
    return [{
      sourceIdentity,
      name,
      sector,
      location,
      address: registeredAddress,
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(sourceIdentity)}`,
      retrievedAt,
      evidence: [
        { kind: 'verified_fact', label: 'Companies House identity', value: `${name} (${sourceIdentity}) is recorded with status ${status}.` },
        { kind: 'verified_fact', label: 'Registered office', value: registeredAddress || 'Companies House did not return a registered-office address.' },
        { kind: 'verified_fact', label: 'Registered SIC codes', value: itemCodes.length ? itemCodes.join(', ') : 'Companies House did not return SIC codes.' },
        { kind: 'unknown', label: 'Local operating presence', value: 'A registered office is not proof of a workplace, branch or recruiting site in the search area.' },
        { kind: 'unknown', label: 'Vacancies and contacts', value: 'Companies House does not verify current vacancies or employer contact details in this search.' },
      ],
    }];
  }).slice(0, 50);
}
