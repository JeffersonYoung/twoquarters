export type CompressionRequest =
  | { type: 'start'; file: File; output: FileSystemFileHandle }
  | { type: 'cancel' };

export type CompressionResponse =
  | { type: 'progress'; progress: number }
  | { type: 'complete' }
  | { type: 'error'; name: string; message: string };
