import type { Action, Deal, DealService, HealthFactor, Interaction, Memory, Outcome, Stage, SystemStatus } from '../types';

export const DEALMIND_API_BASE = (import.meta.env.VITE_DEALMIND_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
export const SEEDED_DEAL_ID = '53df2f8b-70a7-4eeb-90e6-f4d8cb135cfc';

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

interface ApiErrorPayload {
  status: number;
  message: string;
  retryable: boolean;
}

class DealMindApiError extends Error {
  status: number;
  retryable: boolean;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'DealMindApiError';
    this.status = payload.status;
    this.retryable = payload.retryable;
  }
}

const actions = new Map<string, Action>();
const outcomes = new Map<string, Outcome>();
const cache = new Map<string, unknown>();

function today() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function findText(source: unknown, keys: string[]): string {
  if (!isRecord(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function firstArray(source: unknown, keys: string[]): unknown[] {
  if (Array.isArray(source)) return source;
  if (!isRecord(source)) return [];
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function unwrap(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  for (const key of ['data', 'result', 'intelligence', 'deal_intelligence']) {
    if (isRecord(payload[key])) return payload[key];
  }
  return payload;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEALMIND_API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = findText(payload, ['detail', 'message', 'error']);
    const retryable = [502, 503].includes(response.status);
    const labels: Record<number, string> = {
      404: 'The seeded Acme Enterprise deal was not found in DealMind.',
      422: 'DealMind rejected the request payload. Check the API contract for this endpoint.',
      502: 'DealMind is waiting on an upstream service. Please retry when the backend is ready.',
      503: 'DealMind memory or database service is unavailable. Please retry when it is healthy.',
    };
    throw new DealMindApiError({
      status: response.status,
      retryable,
      message: detail || labels[response.status] || `DealMind API returned ${response.status}.`,
    });
  }
  return payload as T;
}

async function cached<T>(key: string, loader: () => Promise<T>, refresh = false): Promise<T> {
  if (!refresh && cache.has(key)) return cache.get(key) as T;
  const value = await loader();
  cache.set(key, value);
  return value;
}

async function health(path: string): Promise<'ok' | 'unavailable'> {
  try {
    await request(path);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

async function getIntelligence(dealId = SEEDED_DEAL_ID, refresh = false) {
  return cached(`intelligence:${dealId}`, () => request<unknown>(`/api/deals/${dealId}/intelligence`, { method: 'POST', body: '{}' }), refresh);
}

async function askRosy(dealId = SEEDED_DEAL_ID, refresh = false) {
  return cached(`ask:${dealId}`, () => request<unknown>(`/api/deals/${dealId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question: 'What should I know about this deal, which memories were used, what evidence supports the recommendation, and is there any temporal insight?' }),
  }), refresh);
}

function getDealName(payload: unknown) {
  const raw = unwrap(payload);
  return findText(raw, ['company', 'company_name', 'account', 'deal_name', 'customer_name']) || 'Acme Enterprise';
}

function getRecommendationText(intelligence: unknown, answer: unknown) {
  const i = unwrap(intelligence);
  const a = unwrap(answer);
  return findText(i, ['recommendation', 'recommended_action', 'next_best_action', 'summary', 'answer', 'response'])
    || findText(a, ['answer', 'response', 'message', 'recommendation'])
    || 'Deal intelligence is available, but the backend did not return a recommendation yet.';
}

function getAnswerText(answer: unknown, intelligence: unknown) {
  const a = unwrap(answer);
  const i = unwrap(intelligence);
  return findText(a, ['answer', 'response', 'message', 'rosy_answer'])
    || findText(i, ['answer', 'response', 'summary', 'recommendation'])
    || 'Rosy did not return an answer yet.';
}

function memoryValues(payload: unknown): unknown[] {
  const raw = unwrap(payload);
  const direct = firstArray(raw, ['memory_used', 'memories_used', 'relevant_memories', 'memories']);
  if (direct.length) return direct;
  const value = isRecord(raw) ? raw.memory_used : undefined;
  const text = asText(value);
  return text ? [text] : [];
}

function evidenceValues(payload: unknown): unknown[] {
  const raw = unwrap(payload);
  return firstArray(raw, ['evidence', 'supporting_evidence', 'sources', 'citations']);
}

function makeInteraction(dealId: string, id: string, title: string, content: string, person = 'DealMind backend'): Interaction {
  return { id, dealId, type: 'Meeting', date: today(), title, content, person };
}

function textFromEvidence(value: unknown): string {
  if (typeof value === 'string') return value;
  return findText(value, ['content', 'text', 'quote', 'evidence', 'summary', 'memory', 'detail']);
}

function idFrom(value: unknown, fallback: string): string {
  return findText(value, ['id', 'memory_id', 'source_id', 'interaction_id']) || fallback;
}

function buildMemories(dealId: string, intelligence: unknown, answer: unknown): Memory[] {
  const memoryUsed = [...memoryValues(intelligence), ...memoryValues(answer)];
  const unique = new Map<string, Memory>();
  memoryUsed.forEach((value, index) => {
    const text = textFromEvidence(value);
    if (!text) return;
    const id = idFrom(value, `api-memory-${index + 1}`);
    unique.set(id, {
      id,
      dealId,
      interactionId: `memory-source-${id}`,
      category: 'memory_used',
      title: findText(value, ['title', 'label']) || `Memory used ${index + 1}`,
      learned: text,
      relevance: findText(value, ['relevance', 'reason', 'why']) || 'Returned by DealMind as memory used for Rosy\'s response.',
      date: today(),
    });
  });
  return [...unique.values()];
}

function buildInteractions(dealId: string, intelligence: unknown, answer: unknown): Interaction[] {
  const interactions: Interaction[] = [];
  const memories = buildMemories(dealId, intelligence, answer);
  memories.forEach(memory => {
    interactions.push(makeInteraction(dealId, memory.interactionId, memory.title, memory.learned, 'DealMind memory_used'));
  });
  const evidence = [...evidenceValues(intelligence), ...evidenceValues(answer)];
  evidence.forEach((value, index) => {
    const content = textFromEvidence(value);
    if (!content) return;
    const id = idFrom(value, `api-evidence-${index + 1}`);
    interactions.push(makeInteraction(dealId, id, findText(value, ['title', 'label']) || `Evidence ${index + 1}`, content, findText(value, ['speaker', 'person', 'source']) || 'DealMind evidence'));
  });
  const temporalInsight = findText(unwrap(intelligence), ['temporal_insight', 'temporalInsight']);
  if (temporalInsight) {
    interactions.push(makeInteraction(dealId, 'api-temporal-insight', 'Temporal insight', temporalInsight, 'DealMind temporal reasoning'));
  }
  const answerText = getAnswerText(answer, intelligence);
  if (answerText) {
    interactions.push(makeInteraction(dealId, 'api-rosy-answer', 'Rosy answer', answerText, 'Rosy'));
  }
  for (const action of actions.values()) if (action.dealId === dealId) interactions.push({ id: action.id, dealId, type: 'Action', date: action.recordedAt, title: 'Recorded seller action', content: action.description, person: 'Akshara' });
  for (const outcome of outcomes.values()) if (outcome.dealId === dealId) interactions.push({ id: outcome.id, dealId, type: 'Outcome', date: outcome.recordedAt, title: outcome.kind, content: outcome.notes || outcome.kind, person: 'Customer outcome' });
  return interactions;
}

function buildDeal(intelligence: unknown): Deal {
  const raw = unwrap(intelligence);
  const company = getDealName(raw);
  const healthText = findText(raw, ['health', 'deal_health', 'health_score']);
  const health = Math.max(0, Math.min(100, Number(healthText) || 50));
  const stage = (findText(raw, ['stage', 'deal_stage']) || 'Evaluation') as Stage;
  return {
    id: SEEDED_DEAL_ID,
    company,
    initials: company.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'AE',
    color: '#e7efe9',
    customer: findText(raw, ['contact', 'champion', 'customer', 'customer_contact']) || 'Acme stakeholder',
    role: findText(raw, ['role', 'title', 'contact_role']) || 'Decision team',
    email: '',
    value: Number(findText(raw, ['value', 'amount', 'deal_value'])) || 0,
    stage: ['Discovery', 'Evaluation', 'Proposal', 'Negotiation', 'Closed won'].includes(stage) ? stage : 'Evaluation',
    probability: Number(findText(raw, ['probability', 'win_probability'])) || 0,
    health,
    risk: health < 55 ? 'High' : health < 75 ? 'Medium' : 'Low',
    lastInteraction: today(),
    closeDate: today(),
    industry: findText(raw, ['industry', 'segment']) || 'Enterprise account',
    recommendation: findText(raw, ['recommendation', 'recommended_action', 'next_best_action', 'summary']) || 'Fetch DealMind intelligence',
    objection: findText(raw, ['objection', 'risk', 'blocker']) || 'No blocker returned by the backend yet.',
    competitor: findText(raw, ['competitor', 'alternative']) || 'Not returned',
  };
}

export function createApiService(): DealService {
  return {
    async getSystemStatus(): Promise<SystemStatus> {
      const [api, db, memory] = await Promise.all([health('/health'), health('/api/health/db'), health('/api/health/memory')]);
      return { api, db, memory, detail: `${DEALMIND_API_BASE}` };
    },
    async getDeals() {
      await this.getSystemStatus();
      const intelligence = await getIntelligence(SEEDED_DEAL_ID);
      return [buildDeal(intelligence)];
    },
    async getDeal(id) {
      if (id !== SEEDED_DEAL_ID) throw new DealMindApiError({ status: 404, retryable: false, message: 'Only the seeded Acme Enterprise deal is available from the current DealMind API.' });
      return buildDeal(await getIntelligence(id));
    },
    async getInteractions(id) {
      const [intelligence, answer] = await Promise.all([getIntelligence(id), askRosy(id)]);
      return buildInteractions(id, intelligence, answer);
    },
    async getMemories(id = SEEDED_DEAL_ID) {
      const [intelligence, answer] = await Promise.all([getIntelligence(id), askRosy(id)]);
      return buildMemories(id, intelligence, answer);
    },
    async getRosyRecommendation(id) {
      const [intelligence, answer] = await Promise.all([getIntelligence(id), askRosy(id)]);
      const memories = buildMemories(id, intelligence, answer);
      const recommendation = getRecommendationText(intelligence, answer);
      const rosyAnswer = getAnswerText(answer, intelligence);
      const temporalInsight = findText(unwrap(intelligence), ['temporal_insight', 'temporalInsight']);
      const rationale = [rosyAnswer, temporalInsight ? `Temporal insight: ${temporalInsight}` : '', memories.length ? `${memories.length} memory item(s) returned by DealMind.` : 'No memory_used field returned yet.'].filter(Boolean);
      return {
        id: `api-recommendation-${id}`,
        dealId: id,
        title: recommendation,
        summary: rosyAnswer,
        confidence: Number(findText(unwrap(intelligence), ['confidence', 'score'])) || 0,
        rationale,
        memoryIds: memories.map(memory => memory.id),
        actionLabel: 'Record seller action',
      };
    },
    async getDealHealth(id) {
      const status = await this.getSystemStatus();
      const factors: HealthFactor[] = [
        { name: 'API', score: status.api === 'ok' ? 100 : 0, evidence: status.api === 'ok' ? 'GET /health returned successfully.' : 'GET /health is unavailable.', interactionId: 'api-rosy-answer' },
        { name: 'Database', score: status.db === 'ok' ? 100 : 0, evidence: status.db === 'ok' ? 'GET /api/health/db returned successfully.' : 'GET /api/health/db is unavailable.', interactionId: 'api-rosy-answer' },
        { name: 'Memory', score: status.memory === 'ok' ? 100 : 0, evidence: status.memory === 'ok' ? 'GET /api/health/memory returned successfully.' : 'GET /api/health/memory is unavailable.', interactionId: 'api-rosy-answer' },
      ];
      if (id !== SEEDED_DEAL_ID) throw new DealMindApiError({ status: 404, retryable: false, message: 'Only the seeded Acme Enterprise deal is available from the current DealMind API.' });
      return factors;
    },
    async recordAction(input) {
      const action: Action = { id: `action-${Date.now()}`, dealId: input.dealId, recommendationId: input.recommendationId, description: input.description, recordedAt: today() };
      await request(`/api/deals/${input.dealId}/interactions`, { method: 'POST', body: JSON.stringify({ type: 'action', content: input.description, recommendation_id: input.recommendationId }) });
      actions.set(action.id, action);
      cache.delete(`intelligence:${input.dealId}`);
      cache.delete(`ask:${input.dealId}`);
      return action;
    },
    async recordOutcome(input) {
      const outcome: Outcome = { id: `outcome-${Date.now()}`, actionId: input.actionId, dealId: input.dealId, kind: input.kind, notes: input.notes, recordedAt: today() };
      await request(`/api/deals/${input.dealId}/interactions`, { method: 'POST', body: JSON.stringify({ type: 'outcome', outcome: input.kind, content: input.notes, action_id: input.actionId }) });
      outcomes.set(outcome.id, outcome);
      cache.delete(`intelligence:${input.dealId}`);
      cache.delete(`ask:${input.dealId}`);
      return outcome;
    },
    async updateMemory(outcomeId) {
      const outcome = outcomes.get(outcomeId);
      if (!outcome) throw new Error('Record an outcome before refreshing memory.');
      const [intelligence, answer] = await Promise.all([getIntelligence(outcome.dealId, true), askRosy(outcome.dealId, true)]);
      const memories = buildMemories(outcome.dealId, intelligence, answer);
      const latest = memories[0];
      if (!latest) throw new Error('DealMind accepted the interaction, but did not return memory_used for this deal yet.');
      return latest;
    },
    async updateDealStage(dealId, stage) {
      const deal = await this.getDeal(dealId);
      return { ...deal, stage };
    },
  };
}
