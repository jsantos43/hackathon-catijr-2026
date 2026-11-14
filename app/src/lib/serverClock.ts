// O relógio que vale é o do servidor (RF16). Toda resposta da API que traz `serverTime`
// atualiza a diferença entre o relógio local e o do servidor; as contagens usam serverNow().

let offsetMs = 0;

export const syncServerTime = (serverTime: string | undefined, sentAt?: number) => {
  if (!serverTime) return;
  const server = Date.parse(serverTime);
  if (Number.isNaN(server)) return;
  const now = Date.now();
  // Compensa metade da ida e volta, se soubermos quando o pedido saiu.
  const latency = sentAt ? (now - sentAt) / 2 : 0;
  offsetMs = server + latency - now;
};

export const serverNow = () => Date.now() + offsetMs;
