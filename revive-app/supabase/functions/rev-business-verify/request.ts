export type CompaniesHouseIdentity = {
  companyNumber?: string;
  businessName?: string;
  postcode?: string;
  locality?: string;
};

export type CompaniesHouseHttpRequest = {
  url: string;
  init: RequestInit;
};

export function buildCompaniesHouseRequest(identity: CompaniesHouseIdentity, apiKey: string): CompaniesHouseHttpRequest {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) throw new Error('Companies House API key is empty.');
  const headers = {
    Authorization: `Basic ${btoa(`${trimmedApiKey}:`)}`,
    Accept: 'application/json',
  };
  if (identity.companyNumber) {
    return {
      url: `https://api.company-information.service.gov.uk/company/${encodeURIComponent(identity.companyNumber)}`,
      init: { method: 'GET', headers },
    };
  }
  const query = new URLSearchParams({ q: identity.businessName ?? '', items_per_page: '20' });
  return {
    url: `https://api.company-information.service.gov.uk/search/companies?${query.toString()}`,
    init: { method: 'GET', headers },
  };
}
