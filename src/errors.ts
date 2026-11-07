export class EnvManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvManagerError';
  }
}

// A distinct exit code lets callers tell "no setup" apart from a broken one.
export class NotInitializedError extends EnvManagerError {
  static readonly exitCode = 3;

  constructor(message: string) {
    super(message);
    this.name = 'NotInitializedError';
  }
}

export function configError(file: string, line: number, message: string): never {
  throw new EnvManagerError(`${file}:${line}: ${message}`);
}
