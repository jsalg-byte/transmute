import { z } from 'zod';

export const planDayExerciseUpdateSchema = z.object({
  targetSets: z.number().int().positive().max(20),
  targetReps: z.number().int().positive().max(50).nullable(),
  targetWeight: z.number().nonnegative().max(2_000).nullable(),
  trackingMode: z.enum(['reps', 'timed']).default('reps'),
  targetDurationSeconds: z.number().int().positive().max(86_400).nullable().optional(),
}).refine(
  (value) => value.trackingMode !== 'timed' || value.targetDurationSeconds != null,
  { message: 'Timed exercises require a target duration.' },
);

export const workoutSetSchema = z.object({
  exerciseId: z.string().uuid(),
  reps: z.number().int().positive().max(100).optional(),
  durationSeconds: z.number().int().positive().max(86_400).optional(),
  weight: z.number().nonnegative().max(2_000).optional(),
  isWarmup: z.boolean().optional(),
  clientOperationId: z.string().uuid().optional(),
}).refine((value) => (value.reps != null) !== (value.durationSeconds != null), {
  message: 'Provide either reps or durationSeconds, but not both.',
});
