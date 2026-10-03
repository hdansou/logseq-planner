export const LARGE_PAGE: string;
export const LARGE_TAG: string;
export const DEFAULT_N: number;
export const DEFAULT_SEED: number;
export interface LargeNode { uuid: string; title: string; start: number | null; end: number | null; status: string; lead: string | null; team: string | null }
export interface LargeTask { uuid: string; node: string; title: string; status: string; deadlineOffset: number | null }
export interface LargeSeedOptions { n?: number; today?: Date; seed?: number; propPrefix?: string }
export function buildLargeSeed(opts?: LargeSeedOptions): { nodes: LargeNode[]; tasks: LargeTask[]; edn: string };
export function seedLargeEdn(opts?: LargeSeedOptions): string;
