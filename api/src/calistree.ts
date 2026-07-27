export type CalistreeCatalogEntry = {
  name: string;
  slug: string;
};

export type CalistreeExerciseMetadata = CalistreeCatalogEntry & {
  category: 'strength' | 'cardio' | 'mobility';
  muscleGroup: string | null;
  videoUrl: string | null;
  sourceUrl: string;
};

const CALISTREE_EXERCISES_URL = 'https://calistree.app/exercises';
const CALISTREE_BASE_URL = 'https://calistree.app';

let catalogPromise: Promise<CalistreeCatalogEntry[]> | null = null;
const metadataPromises = new Map<string, Promise<CalistreeExerciseMetadata | null>>();

function normalize(input: string) {
  return input
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function getCalistreeCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CALISTREE_EXERCISES_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Calistree catalog request failed: ${response.status}`);

        const html = await response.text();
        const entries = new Map<string, CalistreeCatalogEntry>();
        const pattern = /<a href="\/datasheet\/([^"]+)">([^<]+)<\/a>/g;
        for (const match of html.matchAll(pattern)) {
          const slug = decodeHtml(match[1]);
          const name = decodeHtml(match[2]).trim();
          if (name && slug) entries.set(slug, { name, slug });
        }
        return Array.from(entries.values());
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }

  return catalogPromise;
}

export async function searchCalistreeExercises(query: string, limit = 8) {
  const needle = normalize(query);
  if (needle.length < 2) return [];

  const words = needle.split(' ');
  return (await getCalistreeCatalog())
    .map((entry) => ({ entry, normalizedName: normalize(entry.name) }))
    .filter(({ normalizedName }) => words.every((word) => normalizedName.includes(word)))
    .sort((left, right) => {
      const leftScore = left.normalizedName === needle ? 0 : left.normalizedName.startsWith(needle) ? 1 : 2;
      const rightScore = right.normalizedName === needle ? 0 : right.normalizedName.startsWith(needle) ? 1 : 2;
      return leftScore - rightScore || left.entry.name.localeCompare(right.entry.name);
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function toCategory(tag: string): CalistreeExerciseMetadata['category'] {
  const value = tag.toLowerCase();
  if (value.includes('cardio')) return 'cardio';
  if (value.includes('mobility') || value.includes('flexibility') || value.includes('stretch')) return 'mobility';
  return 'strength';
}

function videoUrlFromPage(html: string) {
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!jsonLd) return null;

  try {
    const document = JSON.parse(jsonLd) as { '@graph'?: Array<{ '@type'?: unknown; contentUrl?: unknown }> };
    const video = document['@graph']?.find((item) => item['@type'] === 'VideoObject');
    return typeof video?.contentUrl === 'string' ? video.contentUrl : null;
  } catch {
    return null;
  }
}

async function metadataForEntry(entry: CalistreeCatalogEntry): Promise<CalistreeExerciseMetadata | null> {
  if (!metadataPromises.has(entry.slug)) {
    metadataPromises.set(entry.slug, fetch(`${CALISTREE_BASE_URL}/datasheet/${entry.slug}`)
      .then(async (response) => {
        if (!response.ok) return null;
        const html = await response.text();
        const tag = html.match(/<ul class="tags">\s*<li>([^<]+)/)?.[1] ?? 'strength';
        const musclesMarkup = html.match(/<h2>Muscles<\/h2>\s*<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
        const muscleGroups = Array.from(musclesMarkup.matchAll(/<li><a[^>]*>([^<]+)/g), (match) => decodeHtml(match[1]));
        return {
          ...entry,
          category: toCategory(decodeHtml(tag)),
          muscleGroup: muscleGroups.length ? muscleGroups.join(', ') : null,
          videoUrl: videoUrlFromPage(html),
          sourceUrl: `${CALISTREE_BASE_URL}/datasheet/${entry.slug}`,
        };
      })
      .catch(() => null));
  }
  return metadataPromises.get(entry.slug)!;
}

export async function getCalistreeExerciseMetadata({ name, slug }: { name?: string; slug?: string | null }) {
  const catalog = await getCalistreeCatalog();
  const entry = slug
    ? catalog.find((candidate) => candidate.slug === slug)
    : catalog.find((candidate) => Boolean(name) && normalize(candidate.name) === normalize(name!));
  return entry ? metadataForEntry(entry) : null;
}
