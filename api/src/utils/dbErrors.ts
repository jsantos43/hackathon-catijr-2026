import { Prisma } from '../generated/prisma/client.js';

const isKnownError = (err: unknown, code: string): err is Prisma.PrismaClientKnownRequestError =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

/**
 * Se o erro for violação de unique (P2002), retorna o nome do campo duplicado
 * ('' quando não dá para descobrir). Para qualquer outro erro, retorna undefined.
 */
export const uniqueViolationField = (err: unknown): string | undefined => {
  if (!isKnownError(err, 'P2002')) return undefined;

  const meta = err.meta as
    | {
        target?: string[] | string;
        modelName?: string;
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[]; index?: string } };
        };
      }
    | undefined;

  const constraint = meta?.driverAdapterError?.cause?.constraint;

  // Com driver adapter (pg), o Prisma só informa o nome do índice: "User_email_key" -> "email".
  const fromIndex = constraint?.index
    ?.replace(new RegExp(`^${meta?.modelName ?? '[^_]+'}_`), '')
    .replace(/_key$/, '');

  const fields =
    constraint?.fields ??
    (fromIndex ? [fromIndex] : undefined) ??
    (typeof meta?.target === 'string' ? [meta.target] : meta?.target);

  return fields?.map((f) => f.replace(/"/g, '')).join(', ') ?? '';
};

/** Registro não encontrado em update/delete (P2025). */
export const isRecordNotFound = (err: unknown) => isKnownError(err, 'P2025');

/** Violação de chave estrangeira (P2003): o registro ainda é usado por outro. */
export const isForeignKeyViolation = (err: unknown) => isKnownError(err, 'P2003');
