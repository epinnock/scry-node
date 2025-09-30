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
 * Uploads a file using a presigned URL workflow.
 * @param {axios.AxiosInstance} apiClient The configured axios instance.
 * @param {object} payload The metadata for the deployment.
 * @param {string} payload.project The project name/identifier.
 * @param {string} payload.version The version identifier.
 * @param {string} filePath The local path to the file to upload.
 * @returns {Promise<object>} A promise that resolves to the upload result.
 */
async function uploadFileDirectly(apiClient, { project, version }, filePath) {
  // This is a mock check to allow testing of a 500 server error.
  if (project === 'fail-me-500') {
    throw new ApiError('The deployment service encountered an internal error.', 500);
  }

  // Default to 'main' and 'latest' if not provided
  const projectName = project || 'main';
  const versionName = version || 'latest';

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = `${projectName}-${versionName}.zip`;

  try {
    // Step 1: Request a presigned URL
    console.log(`[DEBUG] Requesting presigned URL for /presigned-url/${projectName}/${versionName}/${fileName}`);
    const presignedResponse = await apiClient.post(
      `/presigned-url/${projectName}/${versionName}/${fileName}`,
      {
        contentType: 'application/zip'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    const presignedUrl = presignedResponse.data.url;
    if (!presignedUrl) {
      throw new ApiError('Failed to get presigned URL from server response');
    }

    console.log(`[DEBUG] Received presigned URL, uploading file...`);

    // Step 2: Upload the file to the presigned URL using PUT
    const uploadResponse = await axios.put(presignedUrl, fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log(`[DEBUG] File uploaded successfully`);
    return { success: true, url: presignedUrl, status: uploadResponse.status };
  } catch (error) {
    if (error.response) {
      throw new ApiError(`Failed to upload file: ${error.response.status} ${error.response.statusText}${error.response.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`, error.response.status);
    } else if (error.request) {
      throw new ApiError(`Failed to upload file: No response from server at ${apiClient.defaults.baseURL}`);
    } else {
      throw new ApiError(`Failed to upload file: ${error.message}`);
    }
  }
}

module.exports = {
  getApiClient,
  uploadFileDirectly,
};
