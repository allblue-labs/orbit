import type { Request, Response } from 'express';
import type { RequestContext } from '../../context';

export const UPLOAD_RESERVATION = Symbol('verified-upload-reservation');
export interface UploadReservation {
  id: string;
  sizeBytes: number;
  mimeType: string;
  context: RequestContext;
}
export type UploadRequest = Request & {
  [UPLOAD_RESERVATION]?: UploadReservation;
};

/** Stop rejected bodies at the connection boundary rather than draining them indefinitely. */
export function closeUploadRequest(request: Request, response: Response): void {
  if (!response.headersSent) response.setHeader('Connection', 'close');
  response.once('finish', () => {
    if (!request.complete) request.destroy();
  });
}
