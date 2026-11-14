/**
 * Nome curto exibido na sala para preservar a privacidade: "Marina Torres" -> "Marina T.".
 * Aplicar duas vezes não muda nada ("Marina T." continua "Marina T.").
 */
export const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
};
