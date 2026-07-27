import { router } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from './alchemy-svg';

const FADE_DURATION_MS = 180;

const assets = {
  ouroboros: require('../../assets/transmute/ouroboros.svg'),
  putrefaction: require('../../assets/transmute/putrefaction.svg'),
  blackSulfur: require('../../assets/transmute/black-sulfur.svg'),
  purify: require('../../assets/transmute/purify.svg'),
  water: require('../../assets/transmute/water.svg'),
} as const;

const slides = [
  {
    stage: '01 — NIGREDO',
    operation: 'THE BLACKENING',
    title: 'Begin with the\nraw material.',
    description: 'Record the work as it is. Every set, meal, recovery day, and missed mark becomes material for change.',
  },
  {
    stage: '02 — ALBEDO',
    operation: 'THE WHITENING',
    title: 'Separate signal\nfrom noise.',
    description: 'Bring training, recovery, and nutrition into one clear record. Patterns emerge when the work is stripped to what matters.',
  },
  {
    stage: '03 — RUBEDO',
    operation: 'THE REDDENING',
    title: 'Turn insight\ninto form.',
    description: 'See the pattern, keep what works, and refine the process until effort becomes evidence.',
  },
] as const;

function TransmutationMotif({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <View pointerEvents="none" style={styles.motif}>
        <View style={styles.nigredoOuterRing} />
        <View style={styles.nigredoInnerRing} />
        <View style={styles.nigredoCutOne} />
        <View style={styles.nigredoCutTwo} />
        <View style={styles.nigredoCorner} />
        <AlchemySvg source={assets.putrefaction} width={190} height={190} style={styles.putrefaction} />
        <AlchemySvg source={assets.blackSulfur} width={116} height={116} style={styles.blackSulfur} />
      </View>
    );
  }

  if (stage === 1) {
    return (
      <View pointerEvents="none" style={styles.motif}>
        <View style={styles.albedoOuterRing} />
        <View style={styles.albedoInnerRing} />
        <View style={styles.albedoCutOne} />
        <View style={styles.albedoCutTwo} />
        <AlchemySvg source={assets.water} width={112} height={112} style={styles.water} />
        <AlchemySvg source={assets.purify} width={122} height={122} style={styles.purify} />
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={styles.rubedoMotif}>
      <AlchemySvg source={assets.ouroboros} width={500} height={500} style={styles.rubedoOuroboros} />
    </View>
  );
}

export function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fade] = useState(() => new Animated.Value(1));
  const slide = slides[step];
  const isLastSlide = step === slides.length - 1;

  const advance = () => {
    if (isTransitioning || isLastSlide) return;

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
        </View>

        <Animated.View accessibilityLiveRegion="polite" style={[styles.content, { opacity: fade }]}>
          <TransmutationMotif stage={step} />
          <View style={styles.copy}>
            <Text style={styles.stage}>{slide.stage}</Text>
            <Text style={styles.operation}>{slide.operation}</Text>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.description}>{slide.description}</Text>
          </View>
        </Animated.View>

        <View style={styles.actions}>
          {isLastSlide ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => router.push('/sign-up')} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}>
                <Text style={styles.primaryButtonText}>Create account</Text>
              </Pressable>
              <Text style={styles.accountPrompt}>
                Already have an account?{' '}
                <Text accessibilityRole="link" onPress={() => router.push('/sign-in')} style={styles.accountLink}>Sign in</Text>
              </Text>
            </>
          ) : (
            <>
              <Pressable accessibilityRole="button" onPress={advance} disabled={isTransitioning} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, isTransitioning && styles.buttonDisabled]}>
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.accountPromptSpacer} />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  container: { flex: 1, maxWidth: 680, overflow: 'hidden', paddingBottom: 20, paddingHorizontal: 24, paddingTop: 10, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 },
  content: { flex: 1, position: 'relative' },
  motif: { height: 410, overflow: 'hidden', position: 'absolute', right: -70, top: 5, width: 410 },
  nigredoOuterRing: { borderColor: 'rgba(16, 16, 21, 0.25)', borderRadius: 250, borderWidth: 3, height: 365, left: 24, position: 'absolute', top: 24, width: 365 },
  nigredoInnerRing: { borderColor: 'rgba(100, 45, 42, 0.35)', borderRadius: 220, borderWidth: 1, height: 270, left: 72, position: 'absolute', top: 71, width: 270 },
  nigredoCutOne: { backgroundColor: '#F4EFE7', height: 100, position: 'absolute', right: -4, top: 133, transform: [{ rotate: '18deg' }], width: 170 },
  nigredoCutTwo: { backgroundColor: '#F4EFE7', bottom: 20, height: 84, left: 38, position: 'absolute', transform: [{ rotate: '-24deg' }], width: 132 },
  nigredoCorner: { borderColor: 'rgba(16, 16, 21, 0.3)', borderLeftWidth: 1, borderTopWidth: 1, height: 72, left: 84, position: 'absolute', top: 53, width: 95 },
  putrefaction: { left: 40, opacity: 0.38, position: 'absolute', top: 72 },
  blackSulfur: { left: 191, opacity: 0.52, position: 'absolute', top: 218 },
  albedoOuterRing: { borderColor: 'rgba(102, 119, 152, 0.3)', borderRadius: 250, borderWidth: 3, height: 365, left: 24, position: 'absolute', top: 24, width: 365 },
  albedoInnerRing: { borderColor: 'rgba(169, 91, 91, 0.35)', borderRadius: 220, borderWidth: 1, height: 270, left: 72, position: 'absolute', top: 71, width: 270 },
  albedoCutOne: { backgroundColor: '#F4EFE7', height: 90, position: 'absolute', right: -14, top: 125, transform: [{ rotate: '21deg' }], width: 160 },
  albedoCutTwo: { backgroundColor: '#F4EFE7', bottom: 16, height: 80, left: 25, position: 'absolute', transform: [{ rotate: '-23deg' }], width: 133 },
  water: { left: 230, opacity: 0.58, position: 'absolute', top: 54 },
  purify: { left: 87, opacity: 0.46, position: 'absolute', top: 205 },
  rubedoMotif: { height: 450, overflow: 'hidden', position: 'absolute', right: -212, top: -28, width: 500 },
  rubedoOuroboros: { opacity: 0.25, transform: [{ rotate: '8deg' }] },
  copy: { marginTop: 'auto', maxWidth: 560, paddingBottom: 35, paddingTop: 240 },
  stage: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5 },
  operation: { color: '#222328', fontSize: 12, fontWeight: '800', letterSpacing: 2.1, marginTop: 13 },
  title: { color: '#101015', fontSize: 49, fontWeight: '900', letterSpacing: -2.8, lineHeight: 47, marginTop: 13, maxWidth: 510 },
  description: { color: '#222328', fontSize: 17, fontWeight: '500', lineHeight: 27, marginTop: 19, maxWidth: 500 },
  actions: { maxWidth: 560 },
  primaryButton: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 58, paddingHorizontal: 20 },
  primaryButtonPressed: { backgroundColor: '#642D2A' },
  buttonDisabled: { opacity: 0.62 },
  primaryButtonText: { color: '#F4EFE7', fontSize: 16, fontWeight: '800' },
  accountPrompt: { color: '#222328', fontSize: 14, fontWeight: '500', marginTop: 16 },
  accountPromptSpacer: { height: 17, marginTop: 16 },
  accountLink: { fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' },
});
