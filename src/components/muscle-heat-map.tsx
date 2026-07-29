import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { bodyBack } from 'react-muscle-highlighter/dist/esm/assets/bodyBack';
import { bodyFront } from 'react-muscle-highlighter/dist/esm/assets/bodyFront';
import { type TransmutePalette, useTransmuteStyles, useTransmuteTheme } from '../theme/transmute-theme';
import type { RecoveryReadiness, RecoveryStage } from '../lib/recovery';

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
  { terms: ['deltoid', 'delt', 'shoulder'], regions: ['deltoids'] },
  { terms: ['infraspinatus', 'teres', 'rhomboid', 'latissimus', 'lat', 'upper back'], regions: ['upper-back'] },
  { terms: ['trapezius', 'trap'], regions: ['trapezius'] },
  { terms: ['lower back', 'erector', 'spine'], regions: ['lower-back'] },
  { terms: ['abdominal', 'rectus abdominis', 'abs'], regions: ['abs'] },
  { terms: ['oblique'], regions: ['obliques'] },
  { terms: ['glute'], regions: ['gluteal'] },
  { terms: ['quadriceps', 'quad', 'vastus', 'rectus femoris'], regions: ['quadriceps'] },
  { terms: ['hamstring'], regions: ['hamstring'] },
  { terms: ['calf', 'gastrocnemius', 'soleus'], regions: ['calves'] },
  { terms: ['tibialis'], regions: ['tibialis'] },
  { terms: ['adductor'], regions: ['adductors'] },
  { terms: ['hips', 'hip flexor'], regions: ['gluteal', 'quadriceps'] },
  { terms: ['butt thigh'], regions: ['gluteal', 'quadriceps', 'hamstring'] },
  { terms: ['legs', 'lower body'], regions: ['quadriceps', 'hamstring', 'calves', 'gluteal'] },
  { terms: ['arms'], regions: ['biceps', 'triceps', 'forearm'] },
  { terms: ['core'], regions: ['abs', 'obliques'] },
  { terms: ['full body'], regions: ['chest', 'deltoids', 'upper-back', 'biceps', 'triceps', 'forearm', 'abs', 'obliques', 'gluteal', 'quadriceps', 'hamstring', 'calves'] },
];

const BODY_GROUP_REGION_MAP: Record<string, Region[]> = {
  Chest: ['chest'],
  Shoulders: ['deltoids', 'trapezius'],
  Arms: ['biceps', 'triceps', 'forearm'],
  Back: ['upper-back', 'lower-back', 'trapezius'],
  Core: ['abs', 'obliques'],
  Legs: ['adductors', 'calves', 'gluteal', 'hamstring', 'quadriceps', 'tibialis'],
};

const RECOVERY_COLORS: Record<RecoveryStage, { fill: string; stroke: string; label: string; timing: string }> = {
  'needs-rest': { fill: '#D94F57', stroke: '#A92F38', label: 'Needs Rest', timing: 'Under 24h since work' },
  recovering: { fill: '#8A69C4', stroke: '#65419E', label: 'Recovering', timing: '24–48h since work' },
  ready: { fill: '#4E8DCA', stroke: '#2867A1', label: 'Ready to Train', timing: '48h+ since work' },
};

export function muscleRegionsFor(muscleGroups: string | null) {
  const text = muscleGroups?.toLowerCase() ?? '';
  const regions = new Set<Region>();
  REGION_MAP.forEach((mapping) => {
    if (mapping.terms.some((term) => text.includes(term))) mapping.regions.forEach((region) => regions.add(region));
  });
  const backDetail = ['upper back', 'lower back', 'infraspinatus', 'teres', 'rhomboid', 'latissimus', 'erector', 'spine'].some((term) => text.includes(term));
  if (/\bback\b/.test(text) && !backDetail) ['upper-back', 'lower-back', 'trapezius'].forEach((region) => regions.add(region as Region));
  return [...regions];
}

function AnatomicalBody({ side, active, palette, stages }: { side: 'front' | 'back'; active: Region[]; palette: TransmutePalette; stages?: Partial<Record<Region, RecoveryStage>> }) {
  const body = (side === 'front' ? bodyFront : bodyBack) as MuscleShape[];
  const viewBox = side === 'front' ? '0 0 724 1448' : '724 0 724 1448';
  return <Svg width={112} height={224} viewBox={viewBox} accessibilityLabel={`${side === 'front' ? 'Front' : 'Back'} muscle emphasis`}>
    {body.flatMap((shape) => {
      const region = shape.slug as Region;
      const highlighted = active.includes(region);
      const recoveryColor = stages?.[region] ? RECOVERY_COLORS[stages[region]!] : null;
      const paths = [...(shape.path.common ?? []), ...(shape.path.left ?? []), ...(shape.path.right ?? [])];
      return paths.map((d, index) => <Path
        key={`${shape.slug}-${index}`}
        d={d}
        fill={recoveryColor?.fill ?? (highlighted ? '#D96B63' : palette.raised)}
        stroke={recoveryColor?.stroke ?? (highlighted ? '#A33B36' : palette.divider)}
        strokeWidth={4}
      />);
    })}
  </Svg>;
}

function recoveryStagesForRegions(readiness: RecoveryReadiness[]) {
  const stages: Partial<Record<Region, RecoveryStage>> = {};
  readiness.forEach(({ name, stage }) => {
    (BODY_GROUP_REGION_MAP[name] ?? []).forEach((region) => {
      stages[region] = stage;
    });
  });
  return stages;
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

export function RecoveryBodyMap({ readiness }: { readiness: RecoveryReadiness[] }) {
  const styles = useTransmuteStyles(baseStyles);
  const { palette } = useTransmuteTheme();
  const stages = recoveryStagesForRegions(readiness);

  return <View style={styles.wrap}>
    <View style={styles.bodies}>
      <AnatomicalBody side="front" active={[]} palette={palette} stages={stages} />
      <AnatomicalBody side="back" active={[]} palette={palette} stages={stages} />
    </View>
    <View style={styles.recoveryLegend}>
      {(Object.keys(RECOVERY_COLORS) as RecoveryStage[]).map((stage) => {
        const status = RECOVERY_COLORS[stage];
        return <View key={stage} style={styles.recoveryLegendItem}>
          <View style={[styles.recoveryLegendMark, { backgroundColor: status.fill, borderColor: status.stroke }]} />
          <View style={styles.recoveryLegendCopy}>
            <Text style={styles.recoveryLegendLabel}>{status.label}</Text>
            <Text style={styles.recoveryLegendTiming}>{status.timing}</Text>
          </View>
        </View>;
      })}
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
  legendMark: { color: '#A33B36' },
  recoveryLegend: { borderTopColor: '#D4C9B9', borderTopWidth: 1, gap: 8, paddingTop: 12, width: '100%' },
  recoveryLegendItem: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  recoveryLegendMark: { borderWidth: 1, height: 11, width: 11 },
  recoveryLegendCopy: { flexDirection: 'row', flexGrow: 1, justifyContent: 'space-between' },
  recoveryLegendLabel: { color: '#101015', fontSize: 12, fontWeight: '800' },
  recoveryLegendTiming: { color: '#655D57', fontSize: 11 },
});
