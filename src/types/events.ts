export type Gender = "boys" | "girls";
export type GenderOrder = "boys-first" | "girls-first";
export type AgeOrder = "youngest-first" | "oldest-first";

export interface TrackEventDraft {
  eventName: string;
  customEventName?: string;
  laneCount: number | null;
  ageGroups: string[];
  genders: Gender[];
  genderOrder: GenderOrder;
  ageOrder: AgeOrder;
  useStarterConfirmation?: boolean;
  sessionId?: string;
  createdAt: string;
}
