import { OnboardingFlow } from '@/components/onboarding-flow';
import { View } from 'react-native';

import { useAuthRouteGuard } from '../hooks/use-auth-route-guard';

export default function OnboardingScreen() {
  const isCheckingSession = useAuthRouteGuard();
  if (isCheckingSession) return <View style={{ backgroundColor: '#F4EFE7', flex: 1 }} />;

  return <OnboardingFlow />;
}
