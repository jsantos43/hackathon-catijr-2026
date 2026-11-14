import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export const hash = (value: string) => bcrypt.hash(value, SALT_ROUNDS);

export const compareHash = (value: string, hashed: string) => bcrypt.compare(value, hashed);
