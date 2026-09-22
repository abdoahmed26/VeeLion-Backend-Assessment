const HttpError = require('../utils/httpError');

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const candidate = error.statusCode || error.status;
  const statusCode =
    Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message =
    error.type === 'entity.parse.failed'
      ? 'Body must contain valid JSON.'
      : statusCode >= 500
        ? 'Internal server error'
        : error.message;

  const response = {
    error: {
      message,
    },
  };

  if (error instanceof HttpError && error.details) {
    response.error.details = error.details;
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;
