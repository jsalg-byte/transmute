type SessionListener = (userId: string | null) => void;

const listeners = new Set<SessionListener>();

export function notifySessionChanged(userId: string | null) {
  listeners.forEach((listener) => listener(userId));
}

export function subscribeToSessionChanges(listener: SessionListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
