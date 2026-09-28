export type Stage = 'Discovery' | 'Evaluation' | 'Proposal' | 'Negotiation' | 'Closed won';
export type Risk = 'High' | 'Medium' | 'Low';
export type RosyState = 'idle' | 'analyzing' | 'insight' | 'recommendation' | 'learning' | 'success';
export interface Deal { id: string; company: string; initials: string; color: string; customer: string; role: string; email: string; value: number; stage: Stage; probability: number; health: number; risk: Risk; lastInteraction: string; closeDate: string; industry: string; recommendation: string; objection: string; competitor: string }
export interface Interaction { id: string; dealId: string; type: 'Email' | 'Meeting' | 'Call' | 'Action' | 'Outcome'; date: string; title: string; content: string; person: string }
export interface Memory { id: string; dealId: string; interactionId: string; category: string; title: string; learned: string; relevance: string; date: string; isNew?: boolean }
export interface Recommendation { id: string; dealId: string; title: string; summary: string; confidence: number; rationale: string[]; memoryIds: string[]; actionLabel: string }
export interface HealthFactor { name: string; score: number; evidence: string; interactionId: string }
export interface Action { id: string; dealId: string; recommendationId: string; description: string; recordedAt: string }
export type OutcomeKind = 'Meeting booked' | 'Positive reply' | 'No response' | 'Objection remains';
export interface Outcome { id: string; actionId: string; dealId: string; kind: OutcomeKind; notes: string; recordedAt: string }
export interface SystemStatus { api: 'ok' | 'unavailable'; db: 'ok' | 'unavailable'; memory: 'ok' | 'unavailable'; detail?: string }
export interface DealService {
  getSystemStatus(): Promise<SystemStatus>;
  getDeals(): Promise<Deal[]>;
  getDeal(id: string): Promise<Deal>;
  getInteractions(dealId: string): Promise<Interaction[]>;
  getMemories(dealId?: string): Promise<Memory[]>;
  getRosyRecommendation(dealId: string): Promise<Recommendation>;
  getDealHealth(dealId: string): Promise<HealthFactor[]>;
  recordAction(input: Pick<Action, 'dealId' | 'recommendationId' | 'description'>): Promise<Action>;
  recordOutcome(input: Pick<Outcome, 'actionId' | 'dealId' | 'kind' | 'notes'>): Promise<Outcome>;
  updateMemory(outcomeId: string): Promise<Memory>;
  updateDealStage(dealId: string, stage: Stage): Promise<Deal>;
}
