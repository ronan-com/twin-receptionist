import { ValidationError } from "./prompt";

/** Runs `work`, but answers with a plain error if it takes longer than `seconds` (so a screen never waits forever). */
export async function withinSeconds<T>(seconds: number, message: string, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new ValidationError(message)), seconds * 1000)))]);
  } finally {
    clearTimeout(timer);
  }
}
