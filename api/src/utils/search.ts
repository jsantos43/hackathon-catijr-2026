/**
 * Padrão para ILIKE a partir do texto digitado: escapa os curingas do LIKE (% e _) para que
 * "50%" procure "50%" de verdade, e envolve com % para achar "pedaço do nome" (RF21).
 * Use sempre junto de unaccent(...) dos dois lados, para "camera" achar "Câmera".
 */
export const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
