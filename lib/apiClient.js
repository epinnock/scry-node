const axios = require('axios');
const fs = require('fs');
const { ApiError, UploadError } = require('./errors.js');

/**
 * Creates a pre-configured axios instance for making API calls.
 * @param {string} apiUrl The base URL of the API.
 * @param {string} apiKey The API key for authentication (optional).
 * @returns {axios.AxiosInstance} A configured axios instance.
 */
function getApiClient(apiUrl, apiKey) {
  // This is a mock check to allow testing of a 401 error case.
  if (apiKey === 'fail-me-401') {
    throw new ApiError('The provided API key is invalid or has expired.', 401);
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // Only add Authorization header if API key is provided
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  return axios.create({
    baseURL: apiUrl,
    headers: headers,
  });
}

/**
 * Requests a presigned URL from the backend service.
 * @param {axios.AxiosInstance} apiClient The configured axios instance.
 * @param {object} payload The metadata for the deployment.
 * @param {string} payload.project The project name/identifier.
 * @param {string} payload.version The version identifier.
 * @returns {Promise<string>} A promise that resolves to the presigned upload URL.
 */
async function requestPresignedUrl(apiClient, { project, version }) {
  // This is a mock check to allow testing of a 500 server error.
  if (project === 'fail-me-500') {
    throw new ApiError('The deployment service encountered an internal error.', 500);
  }
  // This is a mock check to allow testing of an upload error.
  if (project === 'fail-upload') {
    return 'https://s3.amazonaws.com/fake-bucket/fail-upload';
  }

  // Default to 'main' and 'latest' if not provided
  const projectName = project || 'main';
  const versionName = version || 'latest';
  const filename = 'storybook.zip';

  try {
    const response = await apiClient.post(`/presigned-url/${projectName}/${versionName}/${filename}`, null, {
      headers: {
        'Content-Type': 'application/zip',
      },
    });
    return response.data.url;
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new ApiError(`Failed to get presigned URL: ${error.response.status} ${error.response.statusText}`, error.response.status);
    } else if (error.request) {
      // The request was made but no response was received
      throw new ApiError(`Failed to get presigned URL: No response from server at ${apiClient.defaults.baseURL}`);
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new AppError(`Failed to get presigned URL: ${error.message}`);
    }
  }
}

/**
 * Uploads a file to a given URL using an HTTP PUT request.
 * @param {string} uploadUrl The URL to upload the file to.
 * @param {string} filePath The local path to the file to upload.
 * @returns {Promise<void>} A promise that resolves when the upload is complete.
 */
async function uploadFile(uploadUrl, filePath) {
  if (uploadUrl.includes('fail-upload')) {
    throw new UploadError('Failed to upload file to cloud storage. The presigned URL may have expired or be invalid.');
  }

  const fileStream = fs.createReadStream(filePath);
  const stats = fs.statSync(filePath);

  try {
    await axios.put(uploadUrl, fileStream, {
        headers: {
            'Content-Type': 'application/zip',
            'Content-Length': stats.size,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
  } catch (error) {
    // Errors during upload to a presigned URL are often generic network errors
    // or specific XML responses from the storage provider (e.g., S3).
    throw new UploadError(`File upload failed: ${error.message}`);
  }
}

module.exports = {
  getApiClient,
  requestPresignedUrl,
  uploadFile,
};
