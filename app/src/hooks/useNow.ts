import { useEffect, useState } from 'react';
import { serverNow } from '../lib/serverClock';

/** Hora do servidor, atualizada a cada `intervalMs`. O relógio é só visual (RF16). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
