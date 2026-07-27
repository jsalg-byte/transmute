import { OnboardingFlow } from '@/components/onboarding-flow';
import { View } from 'react-native';

import { useAuthRouteGuard } from '../hooks/use-auth-route-guard';
import { useTransmuteTheme } from '../theme/transmute-theme';

export default function OnboardingScreen() {
  const { palette } = useTransmuteTheme();
  const isCheckingSession = useAuthRouteGuard();
  if (isCheckingSession) return <View style={{ backgroundColor: palette.surface, flex: 1 }} />;

  return <OnboardingFlow />;
}
