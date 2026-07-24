import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { resumeSession } from '../lib/api';

/** Redirects a persisted authenticated session away from public routes. */
export function useAuthRouteGuard() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let isMounted = true;

    void resumeSession().then((session) => {
      if (!isMounted) return;
      if (session) {
        router.replace('/dashboard');
        return;
      }
      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  return isCheckingSession;
}
