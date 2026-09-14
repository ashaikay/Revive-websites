import { DataProvider } from '@/domain/repositories';
import { createMockDataProvider } from './mockProvider';
import { seedData } from './seedFixtures';
import { dataProviderMode } from '@/services/authService';

export { dataProviderMode };

export type DataProviderMode = 'mock-development' | 'supabase';

export const dataProvider: DataProvider = createMockDataProvider(seedData);
