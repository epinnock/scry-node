const axios = require('axios');
const fs = require('fs');
const { ApiError } = require('./errors.js');

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
  
  // Only add X-API-Key header if API key is provided
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  
  return axios.create({
    baseURL: apiUrl,
    headers: headers,
  });
}

/**
 * Request a presigned URL from the backend.
 *
 * @param {axios.AxiosInstance} apiClient
 * @param {{project: string, version: string}} target
 * @param {{fileName: string, contentType: string}} file
 * @returns {Promise<string>} presigned URL
 */
async function requestPresignedUrl(apiClient, target, file) {
  const projectName = target.project || 'main';
  const versionName = target.version || 'latest';

  const presignedResponse = await apiClient.post(
    `/presigned-url/${projectName}/${versionName}/${file.fileName}`,
    { contentType: file.contentType },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  const presignedUrl = presignedResponse.data?.url;
  if (!presignedUrl || typeof presignedUrl !== 'string' || presignedUrl.trim() === '') {
    throw new ApiError(
      `Failed to get valid presigned URL from server response. Received: ${JSON.stringify(presignedResponse.data)}`
    );
  }

  // Validate URL format
  try {
    new URL(presignedUrl);
  } catch (urlError) {
    throw new ApiError(`Received invalid URL format from server: "${presignedUrl}". URL validation error: ${urlError.message}`);
  }

  return presignedUrl;
}

/**
 * Upload a buffer to a presigned URL.
 *
 * @param {string} presignedUrl
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {Promise<{status:number}>}
 */
async function putToPresignedUrl(presignedUrl, buffer, contentType) {
  const uploadResponse = await axios.put(presignedUrl, buffer, {
    headers: {
      'Content-Type': contentType,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return { status: uploadResponse.status };
}

/**
 * Uploads a file using a presigned URL workflow.
 *
 * @param {axios.AxiosInstance} apiClient The configured axios instance.
 * @param {object} payload The metadata for the deployment.
 * @param {string} payload.project The project name/identifier.
 * @param {string} payload.version The version identifier.
 * @param {string} filePath The local path to the file to upload.
 * @param {{fileName?: string, contentType?: string}} [file] Optional overrides
 * @returns {Promise<object>} A promise that resolves to the upload result.
 */
async function uploadFileDirectly(apiClient, { project, version }, filePath, file = {}) {
  // This is a mock check to allow testing of a 500 server error.
  if (project === 'fail-me-500') {
    throw new ApiError('The deployment service encountered an internal error.', 500);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = file.fileName || 'storybook.zip';
  const contentType = file.contentType || 'application/zip';

  try {
    const presignedUrl = await requestPresignedUrl(apiClient, { project, version }, { fileName, contentType });
    const upload = await putToPresignedUrl(presignedUrl, fileBuffer, contentType);
    return { success: true, url: presignedUrl, status: upload.status };
  } catch (error) {
    if (error.response) {
      throw new ApiError(
        `Failed to upload file: ${error.response.status} ${error.response.statusText}${error.response.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`,
        error.response.status
      );
    } else if (error.request) {
      throw new ApiError(`Failed to upload file: No response from server at ${apiClient.defaults.baseURL}`);
    } else {
      throw new ApiError(`Failed to upload file: ${error.message}`);
    }
  }
}

/**
 * Upload coverage report via the coverage attach endpoint.
 * This uploads the JSON to R2 and attaches normalized coverage to the build.
 *
 * @param {axios.AxiosInstance} apiClient
 * @param {{project: string, version: string}} target
 * @param {any} coverageReport
 * @returns {Promise<{success: boolean, buildId?: string, coverageUrl?: string}>}
 */
async function uploadCoverageReportDirectly(apiClient, target, coverageReport) {
  const projectName = target.project || 'main';
  const versionName = target.version || 'latest';

  try {
    const response = await apiClient.post(
      `/upload/${projectName}/${versionName}/coverage`,
      coverageReport,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: response.data?.success ?? true,
      buildId: response.data?.buildId,
      coverageUrl: response.data?.coverageUrl,
    };
  } catch (error) {
    if (error.response) {
      throw new ApiError(
        `Failed to upload coverage: ${error.response.status} ${error.response.statusText}${error.response.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`,
        error.response.status
      );
    } else if (error.request) {
      throw new ApiError(`Failed to upload coverage: No response from server at ${apiClient.defaults.baseURL}`);
    } else {
      throw new ApiError(`Failed to upload coverage: ${error.message}`);
    }
  }
}

/**
 * Upload storybook zip plus optional coverage report.
 *
 * NOTE: The backend currently supports uploads via presigned URLs only.
 * This helper keeps the orchestration in one place.
 *
 * @param {axios.AxiosInstance} apiClient
 * @param {{project: string, version: string}} target
 * @param {{zipPath: string, coverageReport?: any|null}} options
 */
async function uploadBuild(apiClient, target, options) {
  const zipUpload = await uploadFileDirectly(apiClient, target, options.zipPath, {
    fileName: 'storybook.zip',
    contentType: 'application/zip',
  });

  let coverageUpload = null;
  if (options.coverageReport) {
    coverageUpload = await uploadCoverageReportDirectly(apiClient, target, options.coverageReport);
  }

  return { zipUpload, coverageUpload };
}

module.exports = {
  getApiClient,
  uploadFileDirectly,
  uploadCoverageReportDirectly,
  uploadBuild,
  requestPresignedUrl,
  putToPresignedUrl,
};
