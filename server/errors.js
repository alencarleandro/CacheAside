export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}

export function notFound(message) {
  return new HttpError(404, message);
}

export function serviceUnavailable(message) {
  return new HttpError(503, message);
}
