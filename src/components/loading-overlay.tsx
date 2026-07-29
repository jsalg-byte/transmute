import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';

import { AlchemySvg } from './alchemy-svg';
import { useTransmuteTheme } from '../theme/transmute-theme';

const ouroboros = require('../../assets/transmute/ouroboros.svg');

type LoadingOverlayProps = {
  label?: string;
  visible: boolean;
};

/** Blocks duplicate input during a server action while making the pending work visible. */
export function LoadingOverlay({ label = 'Working…', visible }: LoadingOverlayProps) {
  const { mode, palette } = useTransmuteTheme();
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return undefined;

    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    rotation.setValue(0);
    animation.start();
    return () => animation.stop();
  }, [rotation, visible]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Modal animationType="fade" transparent visible={visible} statusBarTranslucent>
      <View accessibilityRole="progressbar" accessibilityLabel={label} style={[styles.backdrop, { backgroundColor: mode === 'dark' ? 'rgba(0, 0, 0, 0.68)' : 'rgba(16, 16, 21, 0.46)' }]}>
        <View style={[styles.mark, { backgroundColor: palette.raised, borderColor: palette.divider }]}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <AlchemySvg source={ouroboros} width={72} height={72} monochrome={mode === 'dark' ? 'light' : undefined} />
          </Animated.View>
          <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  mark: { alignItems: 'center', borderWidth: 1, gap: 16, minWidth: 172, paddingHorizontal: 28, paddingVertical: 24 },
  label: { fontSize: 14, fontWeight: '800' },
});
