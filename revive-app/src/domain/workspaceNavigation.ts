/** Existing workspace destinations. Module permissions determine which are visible. */
export const workspaceNavigationItems = [
  { label: 'Overview', id: 'home', hash: '', symbol: 'grid' },
  { label: 'REV', id: 'rev', hash: '#rev', symbol: 'spark' },
  { label: 'Customers', id: 'customers', hash: '#customers', symbol: 'people' },
  { label: 'Outcomes', id: 'programme', hash: '#programme', symbol: 'target' },
  { label: 'Scheduling', id: 'scheduling', hash: '#scheduling', symbol: 'calendar' },
  { label: 'Growth', id: 'growth', hash: '#growth', symbol: 'growth' },
  { label: 'Business', id: 'business', hash: '#business', symbol: 'business' },
] as const;
