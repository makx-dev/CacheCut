import { customAlphabet } from 'nanoid';

// alphanumeric, avoids ambiguous chars
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', 7);

export const generateCode = () => nanoid();