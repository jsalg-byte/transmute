type WorkoutWorkerRequest = {
  prompt: string;
  exerciseCatalog: {
    library: Array<{ name: string; category: string; muscleGroup: string | null }>;
    calistree: Array<{ name: string }>;
  };
};

export async function requestAiWorkoutDraft({
  workerUrl,
  workerToken,
  prompt,
  exerciseCatalog,
}: WorkoutWorkerRequest & { workerUrl: string; workerToken: string }) {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/workout-draft`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${workerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prompt, exerciseCatalog }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'The plan assistant could not respond right now.');
  }

  const body = await response.json().catch(() => null) as { text?: unknown } | null;
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    throw new Error('The plan assistant returned an empty response.');
  }
  return body.text;
}

export async function requestAiNutritionLabel({
  workerUrl,
  workerToken,
  imageBase64,
}: { workerUrl: string; workerToken: string; imageBase64: string }) {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/nutrition-label`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${workerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ imageBase64 }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'The label assistant could not respond right now.');
  }

  const body = await response.json().catch(() => null) as { text?: unknown } | null;
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    throw new Error('The label assistant returned an empty response.');
  }
  return body.text;
}

export async function requestAiBarcodeLookup({
  workerUrl,
  workerToken,
  barcode,
}: { workerUrl: string; workerToken: string; barcode: string }) {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/barcode-lookup`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${workerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ barcode }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'The barcode assistant could not respond right now.');
  }

  const body = await response.json().catch(() => null) as { text?: unknown } | null;
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    throw new Error('The barcode assistant returned an empty response.');
  }
  return body.text;
}
