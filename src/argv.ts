export function normalizeCliArgs(args: string[]): string[] {
  return args[0] === "--" ? args.slice(1) : args;
}
