/**
 * Base class for all custom application errors.
 */
class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for issues related to file system operations (e.g., zipping).
 */
class FileSystemError extends AppError {
  constructor(message) {
    super(message);
  }
}

/**
 * Error for failures in API communication.
 */
class ApiError extends AppError {
  /**
   * @param {string} message The error message.
   * @param {number} [statusCode] The HTTP status code of the response.
   */
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Error for failures during the file upload process to cloud storage.
 */
class UploadError extends AppError {
  constructor(message) {
    super(message);
  }
}

module.exports = {
  AppError,
  FileSystemError,
  ApiError,
  UploadError,
};
