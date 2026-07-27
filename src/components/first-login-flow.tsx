import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from './alchemy-svg';
import { createThemedStyleProxy, useTransmuteTheme } from '../theme/transmute-theme';

const { width: viewportWidth } = Dimensions.get('window');
const FADE_DURATION_MS = 180;

const assets = {
  ouroboros: require('../../assets/transmute/ouroboros.svg'),
  putrefaction: require('../../assets/transmute/putrefaction.svg'),
  body: require('../../assets/transmute/human-body-silhouette.svg'),
  fire: require('../../assets/transmute/fire.svg'),
  air: require('../../assets/transmute/air.svg'),
  earth: require('../../assets/transmute/earth.svg'),
  water: require('../../assets/transmute/water.svg'),
} as const;

const slides = [
  {
    eyebrow: 'THE RANKS',
    title: 'Build your rank through the work.',
    description:
      'Every logged session, meal, recovery day, and check-in adds weight to the record. Your rank is earned, not assigned.',
    visual: 'ranks',
  },
  {
    eyebrow: 'THE BODY',
    title: 'Discover your body’s potential.',
    description:
      'See the signals your work creates. Training, recovery, and consistency make it easier to understand where to build next.',
    visual: 'body',
  },
  {
    eyebrow: 'THE PLAN',
    title: 'A workout shaped around you.',
    description:
      'Turn your available time, equipment, and training history into a clear next session—built for the work you can actually do.',
    visual: 'plan',
  },
  {
    eyebrow: 'THE GUIDE',
    title: 'Your health and fitness guide.',
    description:
      'Keep training, nutrition, recovery, and progress in one working record. The next decision gets clearer every time you return.',
    visual: 'guide',
  },
] as const;

type Visual = (typeof slides)[number]['visual'];

function Mark({ source, label, style }: { source: (typeof assets)[keyof typeof assets]; label: string; style: object }) {
  return (
    <View style={[styles.mark, style]}>
      <AlchemySvg source={source} width={72} height={72} style={styles.markGlyph} />
      <Text style={styles.markLabel}>{label}</Text>
    </View>
  );
}

function FirstLoginVisual({ visual }: { visual: Visual }) {
  if (visual === 'ranks') {
    return (
      <View style={styles.visual}>
        <View style={styles.rankTrail} />
        <View style={[styles.rankOrbit, styles.rankOrbitOne]} />
        <View style={[styles.rankOrbit, styles.rankOrbitTwo]} />
        <View style={[styles.rankOrbit, styles.rankOrbitThree]} />
        <Mark source={assets.putrefaction} label="I · RAW" style={styles.rankOne} />
        <Mark source={assets.fire} label="II · WORK" style={styles.rankTwo} />
        <Mark source={assets.air} label="III · FORM" style={styles.rankThree} />
        <View style={styles.proofRank}>
          <AlchemySvg source={assets.ouroboros} width={54} height={54} />
          <Text style={styles.markLabel}>IV · PROOF</Text>
        </View>
      </View>
    );
  }

  if (visual === 'body') {
    return (
      <View style={styles.visual}>
        <View style={styles.bodyOuterRing} />
        <View style={styles.bodyInnerRing} />
        <AlchemySvg source={assets.body} width={146} height={258} style={styles.bodySilhouette} />
        <View style={[styles.bodyCallout, styles.bodyCalloutUpper]}>
          <Text style={styles.calloutKicker}>UPPER</Text>
          <Text style={styles.calloutText}>BUILD</Text>
        </View>
        <View style={[styles.bodyCallout, styles.bodyCalloutCore]}>
          <Text style={[styles.calloutKicker, styles.calloutBlue]}>CORE</Text>
          <Text style={styles.calloutText}>STABLE</Text>
        </View>
        <View style={[styles.bodyCallout, styles.bodyCalloutLower]}>
          <Text style={[styles.calloutKicker, styles.calloutGold]}>LOWER</Text>
          <Text style={styles.calloutText}>DRIVE</Text>
        </View>
      </View>
    );
  }

  if (visual === 'plan') {
    return (
      <View style={styles.visual}>
        <View style={styles.planCircle} />
        <View style={styles.planHeading}>
          <Text style={styles.planKicker}>YOUR NEXT SESSION</Text>
          <View style={styles.planRule} />
        </View>
        <View style={styles.planSheet}>
          {[
            ['THU', 'UPPER BODY', '45 MIN'],
            ['01', 'BENCH PRESS', '4 × 8'],
            ['02', 'ROW', '3 × 10'],
            ['03', 'PRESS', '3 × 12'],
          ].map(([index, name, detail], row) => (
            <View key={index} style={[styles.planRow, row === 3 && styles.planRowLast]}>
              <Text style={[styles.planIndex, row === 0 && styles.planIndexActive]}>{index}</Text>
              <Text style={styles.planName}>{name}</Text>
              <Text style={styles.planDetail}>{detail}</Text>
            </View>
          ))}
        </View>
        <AlchemySvg source={assets.air} width={70} height={70} style={styles.planAir} />
      </View>
    );
  }

  return (
    <View style={styles.visual}>
      <AlchemySvg source={assets.ouroboros} width={270} height={270} style={styles.guideOuroboros} />
      <View style={styles.guideLedger}>
        {[
          ['TRAINING', '03'],
          ['NUTRITION', '06'],
          ['RECOVERY', '02'],
          ['PROGRESS', '01'],
        ].map(([label, count], row) => (
          <View key={label} style={[styles.guideRow, row === 3 && styles.guideRowLast]}>
            <Text style={styles.guideLabel}>{label}</Text>
            <Text style={styles.guideCount}>{count}</Text>
          </View>
        ))}
      </View>
      <AlchemySvg source={assets.water} width={70} height={70} style={styles.guideWater} />
      <AlchemySvg source={assets.fire} width={56} height={56} style={styles.guideFire} />
    </View>
  );
}

export function FirstLoginFlow() {
  useTransmuteTheme();
  const [step, setStep] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fade] = useState(() => new Animated.Value(1));
  const slide = slides[step];
  const isLastSlide = step === slides.length - 1;

  const progress = useMemo(() => slides.map((_, index) => index), []);

  const transition = () => {
    if (isTransitioning) return;

    if (isLastSlide) {
      router.replace('/dashboard');
      return;
    }

    setIsTransitioning(true);
    Animated.timing(fade, { toValue: 0, duration: FADE_DURATION_MS, useNativeDriver: false }).start(() => {
      setStep((current) => current + 1);
      Animated.timing(fade, { toValue: 1, duration: FADE_DURATION_MS, useNativeDriver: false }).start(() => {
        setIsTransitioning(false);
      });
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.wordmark}>
            <AlchemySvg source={assets.ouroboros} width={38} height={38} />
            <Text style={styles.wordmarkText}>TRANSMUTE</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: slides.length, now: step + 1 }} style={styles.progress}>
          {progress.map((index) => (
            <View key={index} style={[styles.progressSegment, index === step ? styles.progressActive : index < step ? styles.progressComplete : undefined]} />
          ))}
        </View>

        <Animated.View style={[styles.content, { opacity: fade }]}>
          <FirstLoginVisual visual={slide.visual} />
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.description}>{slide.description}</Text>
          </View>
        </Animated.View>

        <Pressable accessibilityRole="button" onPress={transition} disabled={isTransitioning} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}>
          <Text style={styles.primaryButtonText}>{isLastSlide ? 'Create account' : 'Continue'}</Text>
        </Pressable>
        {isLastSlide && (
          <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} hitSlop={10}>
            <Text style={styles.signInLink}>Already have an account? Sign in</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4EFE7' },
  container: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 24, paddingBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 },
  skip: { color: '#101015', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline', textDecorationColor: '#A95B5B', textDecorationStyle: 'solid' },
  progress: { flexDirection: 'row', gap: 7, marginTop: 28 },
  progressSegment: { height: 4, flex: 1, backgroundColor: 'rgba(162, 172, 173, 0.45)' },
  progressActive: { backgroundColor: '#A95B5B' },
  progressComplete: { backgroundColor: '#7C6D4F' },
  content: { flex: 1 },
  visual: { height: Math.min(350, viewportWidth * 0.82), minHeight: 250, marginTop: 10, overflow: 'hidden' },
  copy: { marginTop: 'auto', paddingTop: 18 },
  eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '700', letterSpacing: 2.4 },
  title: { color: '#101015', fontSize: viewportWidth < 390 ? 43 : 49, fontWeight: '900', letterSpacing: -2.8, lineHeight: viewportWidth < 390 ? 43 : 49, marginTop: 12 },
  description: { color: '#222328', fontSize: 17, fontWeight: '500', lineHeight: 27, marginTop: 18, maxWidth: 560 },
  primaryButton: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 58, marginTop: 28, paddingHorizontal: 20 },
  primaryButtonPressed: { backgroundColor: '#642D2A' },
  primaryButtonText: { color: '#F4EFE7', fontSize: 16, fontWeight: '800' },
  signInLink: { color: '#222328', fontSize: 14, fontWeight: '700', marginTop: 16, textAlign: 'center', textDecorationLine: 'underline', textDecorationColor: '#A95B5B' },
  rankTrail: { backgroundColor: 'rgba(102, 119, 152, 0.32)', height: 1, left: -40, position: 'absolute', top: '49%', transform: [{ rotate: '-21deg' }], width: '125%' },
  rankOrbit: { borderColor: 'rgba(124, 109, 79, 0.45)', borderRadius: 100, position: 'absolute' },
  rankOrbitOne: { borderWidth: 1, height: 94, left: '7%', top: '56%', width: 94 },
  rankOrbitTwo: { borderWidth: 2, height: 112, left: '36%', top: '30%', width: 112 },
  rankOrbitThree: { borderColor: 'rgba(219, 197, 127, 0.7)', borderWidth: 3, height: 130, right: '7%', top: '4%', width: 130 },
  mark: { alignItems: 'center', position: 'absolute' },
  markGlyph: { opacity: 0.82 },
  markLabel: { color: '#222328', fontFamily: 'Courier', fontSize: 9, fontWeight: '700', letterSpacing: 1.3, marginTop: 2 },
  rankOne: { left: '10%', top: '56%' },
  rankTwo: { left: '40%', top: '27%' },
  rankThree: { right: '10%', top: '3%' },
  proofRank: { alignItems: 'center', bottom: '6%', flexDirection: 'row', gap: 8, position: 'absolute', right: '5%' },
  bodyOuterRing: { borderColor: 'rgba(102, 119, 152, 0.42)', borderRadius: 250, borderWidth: 2, height: 276, left: '50%', marginLeft: -138, position: 'absolute', top: 8, width: 276 },
  bodyInnerRing: { borderColor: 'rgba(169, 91, 91, 0.36)', borderRadius: 220, borderWidth: 1, height: 214, left: '50%', marginLeft: -107, position: 'absolute', top: 39, width: 214 },
  bodySilhouette: { left: '50%', marginLeft: -73, opacity: 0.67, position: 'absolute', top: 13 },
  bodyCallout: { borderLeftWidth: 2, paddingLeft: 8, position: 'absolute' },
  bodyCalloutUpper: { borderLeftColor: '#A95B5B', left: '3%', top: '26%' },
  bodyCalloutCore: { borderLeftColor: '#667798', right: '2%', top: '44%' },
  bodyCalloutLower: { borderLeftColor: '#DBC57F', bottom: '11%', left: '8%' },
  calloutKicker: { color: '#642D2A', fontFamily: 'Courier', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  calloutBlue: { color: '#667798' },
  calloutGold: { color: '#7C6D4F' },
  calloutText: { color: '#101015', fontSize: 12, fontWeight: '900', marginTop: 2 },
  planCircle: { borderColor: 'rgba(219, 197, 127, 0.55)', borderRadius: 200, borderWidth: 3, height: 290, position: 'absolute', right: -130, top: -90, width: 290 },
  planHeading: { alignItems: 'center', flexDirection: 'row', gap: 10, left: '7%', position: 'absolute', top: '12%' },
  planKicker: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '700', letterSpacing: 1.7 },
  planRule: { backgroundColor: 'rgba(100, 45, 42, 0.4)', height: 1, width: 56 },
  planSheet: { borderBottomWidth: 1, borderColor: 'rgba(16, 16, 21, 0.18)', borderTopWidth: 1, marginTop: '28%' },
  planRow: { alignItems: 'center', borderBottomColor: 'rgba(16, 16, 21, 0.14)', borderBottomWidth: 1, flexDirection: 'row', minHeight: 47 },
  planRowLast: { borderBottomWidth: 0 },
  planIndex: { color: '#667798', fontFamily: 'Courier', fontSize: 11, fontWeight: '700', letterSpacing: 1, width: 55 },
  planIndexActive: { color: '#642D2A' },
  planName: { color: '#101015', flex: 1, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  planDetail: { color: '#667798', fontFamily: 'Courier', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  planAir: { bottom: '5%', opacity: 0.48, position: 'absolute', right: '8%' },
  guideOuroboros: { left: '50%', marginLeft: -135, opacity: 0.14, position: 'absolute', top: '50%', transform: [{ translateY: -135 }, { rotate: '8deg' }] },
  guideLedger: { borderBottomColor: 'rgba(16, 16, 21, 0.2)', borderBottomWidth: 1, borderTopColor: 'rgba(16, 16, 21, 0.2)', borderTopWidth: 1, left: '7%', paddingVertical: 5, position: 'absolute', right: '7%', top: '24%' },
  guideRow: { alignItems: 'center', borderBottomColor: 'rgba(16, 16, 21, 0.15)', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  guideRowLast: { borderBottomWidth: 0 },
  guideLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  guideCount: { color: '#101015', fontSize: 22, fontWeight: '900', letterSpacing: -1.2 },
  guideWater: { bottom: '4%', left: '7%', opacity: 0.5, position: 'absolute' },
  guideFire: { opacity: 0.5, position: 'absolute', right: '8%', top: '8%' },
});

const styles = createThemedStyleProxy(baseStyles);
