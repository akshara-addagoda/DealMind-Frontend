import type { DealService } from '../types';
import { createApiService } from './apiClient';

export const dealService: DealService = createApiService();
