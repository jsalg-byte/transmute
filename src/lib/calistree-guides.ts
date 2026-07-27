type CalistreeGuide = { slug: string };

// Calistree hosts these public MP4s. The app streams them in place and never
// downloads or republishes the source media.
const guidesByExercise: Record<string, CalistreeGuide> = {
  'active hang': { slug: 'active-hang-e01a' },
  'arch body hold': { slug: 'arch-body-hold-e01m' },
  'assisted pistol squat': { slug: 'assisted-pistol-squat-e01t' },
  'back lever': { slug: 'back-lever-e01v' },
  'barbell bench press': { slug: 'barbell-bench-press-e01x' },
  'barbell overhead press': { slug: 'barbell-overhead-press-e00g' },
  'barbell row': { slug: 'barbell-bent-over-row-e025' },
  'bulgarian split squat': { slug: 'bulgarian-split-squat-e02b' },
  'calf raise': { slug: 'calf-raise-e0eg' },
  'chin up': { slug: 'chinup-e0hw' },
  'crow pose': { slug: 'crow-pose-e02r' },
  deadlift: { slug: 'deadlift-e0dw' },
  'decline push up': { slug: 'decline-pushup-e03s' },
  'diamond push up': { slug: 'diamond-pushup-e033' },
  dip: { slug: 'dip-e034' },
  'dragon flag': { slug: 'dragon-flag-e038' },
  'front lever': { slug: 'front-lever-e03r' },
  'glute bridge': { slug: 'glute-bridge-e0eh' },
  handstand: { slug: 'handstand-e04b' },
  'handstand push up': { slug: 'handstand-pushup-e04e' },
  'hanging knee raise': { slug: 'hanging-knees-to-chest-e04r' },
  'hanging leg raise': { slug: 'hanging-leg-raises-e04s' },
  'hindu push up': { slug: 'hindu-pushup-e054' },
  'hollow body hold': { slug: 'hollow-body-hold-e057' },
  'incline push up': { slug: 'incline-pushup-e05j' },
  'inverted row': { slug: 'inverted-pullup-e00w' },
  'knee push up': { slug: 'knee-pushup-e064' },
  'lat pulldown': { slug: 'lat-pulldown-e07j' },
  'neutral grip pull up': { slug: 'neutral-grip-pullup-e0hv' },
  'nordic hamstring curl': { slug: 'nordic-curl-e0ee' },
  'pike push up': { slug: 'pike-pushup-e07q' },
  'pistol squat': { slug: 'pistol-squat-e07v' },
  plank: { slug: 'plank-e07z' },
  'pull up': { slug: 'pullup-e085' },
  'push up': { slug: 'pushup-e087' },
  'romanian deadlift': { slug: 'romanian-deadlift-e0dx' },
  'side plank': { slug: 'side-plank-e0ae' },
  'step up': { slug: 'step-up-e0bb' },
  'tuck back lever': { slug: 'tuck-back-lever-e0cf' },
  'tuck front lever': { slug: 'tuck-front-lever-e0cj' },
  'walking lunge': { slug: 'walking-lunge-e0k4' },
};

const videoTokens: Record<string, string> = {
  e00g: '0394e076-c977-420b-bf06-4049392594f4', e00w: '1f2ec197-e867-4c90-a5ad-be118935a485',
  e01a: '988b74c5-92b6-4d9e-b80f-1fa031bb95bf', e01m: '6ce17667-d7cd-4c19-ae7e-d99d30e5c8be',
  e01t: '9c9aba48-7f08-4544-bf8d-f70a75f3fec5', e01v: '56615691-3f45-4164-abd8-2da6ec8c30a6',
  e01x: '2ad4dc8a-f85e-4fb0-86db-af9542d16c04', e025: '57f594ae-0c7d-4ff5-a9c8-dcdb150032fa',
  e02b: '245deb7d-409f-443c-8cac-733cd965e2a4', e02r: '54946652-90fc-41a4-a8fb-b2b9cde5e157',
  e033: '40f24dc4-cd85-4c26-bde9-454f940bd595', e034: 'd6c8fbb0-4623-419c-baf1-5f5b24b7aaf5',
  e038: 'c4fc21a2-cbe7-4cc6-a978-e188b51bb7f4', e03r: 'd9f8a83e-07f0-4dd1-a12b-784d7ce43bf9',
  e03s: '58354ca7-1ba5-46b0-9f85-886eb1851549', e04b: 'b3533cb9-a4ab-4830-b734-1cd0ab6a38eb',
  e04e: '0f3de940-1a2e-4f69-aaf7-11f286c50819', e04r: '08892329-8690-4223-9166-212857acae07',
  e04s: 'cd916b04-abd4-4b8c-9d4b-79eb7d6bc981', e054: '79e766ce-8ab3-4cab-8c1f-df26914856b7',
  e057: 'dd43559c-d0a8-4b1a-89da-5bead7f248b7', e05j: 'cc81db08-168d-44b1-9e48-265c732dc8e4',
  e064: 'de5aa6eb-3f0e-434b-8127-19fa1d0f3335', e07j: 'a2beceaa-e449-4f50-b18e-efd206fa0ec0',
  e07q: 'c5d061cb-3047-4e19-91bd-e59cf4b6b931', e07v: '24d33478-1f94-4b99-8dbd-ea8bd4f850dc',
  e07z: 'b8fbf591-5807-4360-a8ea-c99fdcac7ee0', e085: 'c05d82fc-4950-4f36-bb87-76879030292c',
  e087: '6779a5d0-3d54-40a7-a681-180460064e17', e0ae: '50a322f3-aae5-4fc3-8b00-441be648a7e4',
  e0bb: 'c1c16f8e-d175-46f0-95fe-c7d07f64506a', e0cf: '2721bd42-248d-4615-a719-4be6efd1db49',
  e0cj: '44cad800-3a88-4cc5-8ad9-64117515adb9', e0dw: 'd9eb7b18-e82c-4440-96ab-a61b76390b57',
  e0dx: '295ad915-9042-458b-9a69-88216e7f9e3d', e0ee: '89b5f4aa-0ab5-4b0d-a120-12550ee439ec',
  e0eg: '804a1cb3-6758-41ac-a4ea-74b6fd8fb5e7', e0eh: 'fdd928c5-6de4-490a-ad7e-e812181292b4',
  e0hv: '26f49259-bd47-43cd-b2a0-1d898ee6a9e7', e0hw: 'a956c9d1-1a85-4aee-b433-a3eff3bed658',
  e0k4: '6f1c08b7-85ec-410f-829f-9c9fcef9bb6d',
};

const videoFileSuffixes: Record<string, string> = { e02r: 'f', e07z: 'm', e0ae: 'm' };

function normalizeExerciseName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const compactGuides = new Map(Object.entries(guidesByExercise).map(([name, guide]) => [name.replaceAll(' ', ''), guide]));

export function getCalistreeGuide(exerciseName: string) {
  const normalizedName = normalizeExerciseName(exerciseName);
  const guide = guidesByExercise[normalizedName] ?? compactGuides.get(normalizedName.replaceAll(' ', ''));
  if (!guide) return null;

  const videoId = guide.slug.split('-').at(-1) ?? '';
  const token = videoTokens[videoId];
  if (!token) return null;
  const suffix = videoFileSuffixes[videoId];
  return {
    sourceUrl: `https://calistree.app/datasheet/${guide.slug}`,
    videoUrl: `https://firebasestorage.googleapis.com/v0/b/calistree.appspot.com/o/exerciseVideos%2F${videoId}%2F${videoId}${suffix ? `-${suffix}` : ''}-264.mp4?alt=media&token=${token}`,
  };
}
