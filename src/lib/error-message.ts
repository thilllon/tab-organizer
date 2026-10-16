export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 0 ? err.message : 'Unknown error';
  }
  if (err === undefined || err === null) {
    return 'Unknown error';
  }
  return String(err);
}
