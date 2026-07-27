import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { bodyBack } from 'react-muscle-highlighter/dist/esm/assets/bodyBack';
import { bodyFront } from 'react-muscle-highlighter/dist/esm/assets/bodyFront';
import { type TransmutePalette, useTransmuteStyles, useTransmuteTheme } from '../theme/transmute-theme';

type Region =
  | 'abs' | 'adductors' | 'biceps' | 'calves' | 'chest' | 'deltoids' | 'forearm'
  | 'gluteal' | 'hamstring' | 'lower-back' | 'obliques' | 'quadriceps' | 'tibialis'
  | 'trapezius' | 'triceps' | 'upper-back';

type MusclePath = { common?: string[]; left?: string[]; right?: string[] };
type MuscleShape = { slug: string; path: MusclePath };

const REGION_MAP: { terms: string[]; regions: Region[] }[] = [
  { terms: ['biceps', 'brachialis'], regions: ['biceps'] },
  { terms: ['brachioradialis', 'forearm', 'wrist'], regions: ['forearm'] },
  { terms: ['triceps'], regions: ['triceps'] },
  { terms: ['chest', 'pectoral'], regions: ['chest'] },
  { terms: ['deltoid', 'shoulder'], regions: ['deltoids'] },
  { terms: ['infraspinatus', 'teres', 'rhomboid', 'latissimus', 'lat', 'upper back'], regions: ['upper-back'] },
  { terms: ['trapezius'], regions: ['trapezius'] },
  { terms: ['lower back', 'erector'], regions: ['lower-back'] },
  { terms: ['abdominal', 'rectus'], regions: ['abs'] },
  { terms: ['oblique'], regions: ['obliques'] },
  { terms: ['glute'], regions: ['gluteal'] },
  { terms: ['quadriceps', 'quad'], regions: ['quadriceps'] },
  { terms: ['hamstring'], regions: ['hamstring'] },
  { terms: ['calf', 'gastrocnemius', 'soleus'], regions: ['calves'] },
  { terms: ['tibialis'], regions: ['tibialis'] },
  { terms: ['adductor'], regions: ['adductors'] },
  { terms: ['legs', 'lower body'], regions: ['quadriceps', 'hamstring', 'calves', 'gluteal'] },
  { terms: ['arms'], regions: ['biceps', 'triceps', 'forearm'] },
  { terms: ['core'], regions: ['abs', 'obliques'] },
  { terms: ['full body'], regions: ['chest', 'deltoids', 'upper-back', 'biceps', 'triceps', 'forearm', 'abs', 'obliques', 'gluteal', 'quadriceps', 'hamstring', 'calves'] },
];

export function muscleRegionsFor(muscleGroups: string | null) {
  const text = muscleGroups?.toLowerCase() ?? '';
  const regions = new Set<Region>();
  REGION_MAP.forEach((mapping) => {
    if (mapping.terms.some((term) => text.includes(term))) mapping.regions.forEach((region) => regions.add(region));
  });
  return [...regions];
}

function AnatomicalBody({ side, active, palette }: { side: 'front' | 'back'; active: Region[]; palette: TransmutePalette }) {
  const body = (side === 'front' ? bodyFront : bodyBack) as MuscleShape[];
  const viewBox = side === 'front' ? '0 0 724 1448' : '724 0 724 1448';
  return <Svg width={112} height={224} viewBox={viewBox} accessibilityLabel={`${side === 'front' ? 'Front' : 'Back'} muscle emphasis`}>
    {body.flatMap((shape) => {
      const highlighted = active.includes(shape.slug as Region);
      const paths = [...(shape.path.common ?? []), ...(shape.path.left ?? []), ...(shape.path.right ?? [])];
      return paths.map((d, index) => <Path
        key={`${shape.slug}-${index}`}
        d={d}
        fill={highlighted ? palette.oxideMuted : palette.raised}
        stroke={highlighted ? palette.oxide : palette.divider}
        strokeWidth={4}
      />);
    })}
  </Svg>;
}

export function MuscleHeatMap({
  muscleGroups,
  label = 'MUSCLE EMPHASIS',
  legend = 'Current movement target',
}: {
  muscleGroups: string | null;
  label?: string;
  legend?: string;
}) {
  const styles = useTransmuteStyles(baseStyles);
  const { palette } = useTransmuteTheme();
  const regions = muscleRegionsFor(muscleGroups);
  const labels = muscleGroups?.split(/\s*,\s*/).filter(Boolean) ?? [];
  // The API provides one ordered `muscle_group` string, not primary/secondary roles.
  // Keep that source order, but wrap it into short readable lines instead of a long wall of text.
  const targetLines = labels.reduce<string[]>((lines, label) => {
    const current = lines.at(-1) ?? '';
    const candidate = current ? `${current} · ${label}` : label;
    if (candidate.length > 42 && current) lines.push(label);
    else if (current) lines[lines.length - 1] = candidate;
    else lines.push(label);
    return lines;
  }, []);
  return <View style={styles.wrap}>
    <View style={styles.bodies}><AnatomicalBody side="front" active={regions} palette={palette} /><AnatomicalBody side="back" active={regions} palette={palette} /></View>
    <View style={styles.copy}>
      <Text style={styles.label}>{label}</Text>
      {labels.length ? <View style={styles.targetLines}>{targetLines.map((line) => <Text key={line} style={styles.targets}>{line}</Text>)}</View> : <Text style={styles.empty}>No muscle group is recorded for this movement.</Text>}
      <Text style={styles.legend}><Text style={styles.legendMark}>■</Text> {legend}</Text>
    </View>
  </View>;
}

const baseStyles = StyleSheet.create({
  wrap: { alignItems: 'center', borderTopColor: '#D4C9B9', borderTopWidth: 1, gap: 10, paddingTop: 14 },
  bodies: { flexDirection: 'row', gap: 4 },
  copy: { alignItems: 'center', gap: 4, width: '100%' },
  label: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.25 },
  targetLines: { alignItems: 'center', gap: 2, maxWidth: 330, width: '100%' },
  targets: { color: '#101015', fontSize: 13, fontWeight: '700', lineHeight: 19, textAlign: 'center', textTransform: 'capitalize' },
  empty: { color: '#655D57', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  legend: { color: '#655D57', fontSize: 11 },
  legendMark: { color: '#A95B5B' },
});
