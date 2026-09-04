/**
 * An error whose message is intentionally safe to return to an API client.
 *
 * Only use this type with application-authored messages. Unexpected errors,
 * upstream response bodies, database errors, and other runtime details must
 * remain ordinary Error instances so apiErrorResponse redacts them.
 */
export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    if (!Number.isInteger(status) || status < 400 || status > 499) {
      throw new RangeError("ApiClientError status must be a 4xx status code");
    }
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export class ApiValidationError extends ApiClientError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ApiValidationError";
  }
}

export class ApiConflictError extends ApiClientError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ApiConflictError";
  }
}
