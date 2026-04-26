export class EngineDownError extends Error {
  readonly engineDown = true;

  constructor(message: string) {
    super(message);
    this.name = "EngineDownError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;

  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause.code === "string") return cause.code;

  return undefined;
}
