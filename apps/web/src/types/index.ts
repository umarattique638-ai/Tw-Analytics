// Later this moves into packages/contract
export interface DayPoint { day: string; views: number; visitors: number }
export interface Row { label: string; value: number }
export type DropReason = 'bot' | 'hostname' | 'quota' | 'verification agent';
export interface Warning { reason: DropReason; detail: string; count: number; last: string }
export type InstallMethod = 'script-tag' | 'npm' | 'framework' | 'wordpress';
export interface CheckItem { id: string; label: string; failHint: string }
