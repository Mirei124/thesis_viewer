import type { ChatMessage, CompatibleUsage } from './compatibleProvider';
export type PaperQaScope = 'pre_experiments' | 'body' | 'full';
export type PaperQaSource = { id: string; paragraphId: string; pageIndex: number; section: string; role: string; text: string; evidenceIds: string[] };
export type PaperQaSelection = { text: string; pageIndex: number };
export type PaperQaBlock = { text: string; sources: string[] };
export type PaperQaTurn = {
  id: string; question: string; selection?: PaperQaSelection; createdAt: number;
  status: 'generating' | 'completed' | 'cancelled' | 'error'; text: string;
  blocks?: PaperQaBlock[]; answerStatus?: 'answered' | 'partial' | 'insufficient'; missing?: string; error?: string; usage?: CompatibleUsage; sourceIds: string[];
};
export type PaperQaSession = {
  id: string; documentKey: string; sourceVersion: string; protocolVersion: string;
  title: string; createdAt: number; updatedAt: number; scope: PaperQaScope;
  sourceIds: string[]; messages: ChatMessage[]; turns: PaperQaTurn[]; revision: number;
};
export type PaperQaSessionSummary = Pick<PaperQaSession,
  'id' | 'documentKey' | 'sourceVersion' | 'protocolVersion' | 'title' | 'createdAt' | 'updatedAt' | 'scope' | 'revision'>;
