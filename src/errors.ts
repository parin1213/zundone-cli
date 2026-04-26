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
