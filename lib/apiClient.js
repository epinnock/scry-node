const axios = require('axios');
const fs = require('fs');
const { ApiError } = require('./errors.js');
const { createLogger } = require('./logger.js');

const isVerbose =
  process.env.SCRY_VERBOSE === 'true' ||
  process.env.STORYBOOK_DEPLOYER_VERBOSE === 'true' ||
  process.env.VERBOSE === 'true' ||
  process.env.SCRY_API_DEBUG === 'true' ||
  process.env.SCRY_DEBUG === 'true' ||
  process.argv.includes('--verbose');

const logger = createLogger({ verbose: isVerbose });

const COVERAGE_UPLOAD_DELAY_MS = 5000;
const COVERAGE_RETRY_DELAY_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a pre-configured axios instance for making API calls.
 * @param {string} apiUrl The base URL of the API.
 * @param {string} apiKey The API key for authentication (optional).
 * @returns {axios.AxiosInstance} A configured axios instance.
 */
function getApiClient(apiUrl, apiKey) {
  logger.debug(`Initializing API client with baseURL: ${apiUrl}`);
  // This is a mock check to allow testing of a 401 error case.
  if (apiKey === 'fail-me-401') {
    logger.debug('Mock 401 failure triggered by API key');
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
    timeout: 60000, // 60 second timeout for large uploads
  });
}

/**
 * Request a presigned URL from the backend.
 *
 * @param {axios.AxiosInstance} apiClient
 * @param {{project: string, version: string}} target
 * @param {{fileName: string, contentType: string}} file
 * @returns {Promise<{url: string, visibility?: string}>} presigned URL details
 */
async function requestPresignedUrl(apiClient, target, file) {
  const projectName = target.project || 'main';
  const versionName = target.version || 'latest';

  logger.debug(`Requesting presigned URL for ${projectName}/${versionName}/${file.fileName}`);
  
  const presignedResponse = await apiClient.post(
    `/presigned-url/${projectName}/${versionName}/${file.fileName}`,
    { contentType: file.contentType },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  logger.debug(`Presigned URL response status: ${presignedResponse.status}`);
  if (presignedResponse.data?.buildId || presignedResponse.data?.buildNumber) {
    logger.info(
      `Build record confirmed by presigned URL response (buildId: ${presignedResponse.data?.buildId || 'n/a'}, buildNumber: ${presignedResponse.data?.buildNumber || 'n/a'}).`
    );
  } else {
    logger.debug(
      `Presigned URL response did not include buildId/buildNumber. Response keys: ${Object.keys(presignedResponse.data || {}).join(', ') || 'none'}`
    );
  }
  const presignedUrl = presignedResponse.data?.url;
  const visibility = presignedResponse.data?.visibility;
  if (!presignedUrl || typeof presignedUrl !== 'string' || presignedUrl.trim() === '') {
    logger.debug(`Invalid presigned URL received: ${JSON.stringify(presignedResponse.data)}`);
    throw new ApiError(
      `Failed to get valid presigned URL from server response. Received: ${JSON.stringify(presignedResponse.data)}`
    );
  }

  const parsedUrl = validatePresignedUrl(presignedUrl);
  logger.debug(`Validated presigned URL host: ${parsedUrl.hostname}`);

  return { url: presignedUrl, visibility };
}

function getAxiosErrorDetails(error, fallbackUrl) {
  if (error.response) {
    return {
      message: `HTTP ${error.response.status} ${error.response.statusText}${error.response.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`,
      statusCode: error.response.status,
      kind: 'response'
    };
  }

  if (error.request) {
    const code = error.code ? ` (${error.code})` : '';
    const url = error.config?.url || fallbackUrl || 'unknown URL';
    const baseURL = error.config?.baseURL ? ` (baseURL: ${error.config.baseURL})` : '';
    return {
      message: `No response received from ${url}${baseURL}${code}`,
      statusCode: undefined,
      kind: 'request'
    };
  }

  return {
    message: error.message || 'Unknown error',
    statusCode: undefined,
    kind: 'unknown'
  };
}

function validatePresignedUrl(presignedUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(presignedUrl);
  } catch (urlError) {
    throw new ApiError(`Received invalid URL format from server: "${presignedUrl}". URL validation error: ${urlError.message}`);
  }

  const hostname = parsedUrl.hostname || '';
  if (hostname.includes('undefined')) {
    throw new ApiError(
      `Presigned URL hostname contains "undefined": ${hostname}. This usually means the upload service is missing its R2 account ID or bucket configuration.`
    );
  }

  if (!hostname.endsWith('.r2.cloudflarestorage.com')) {
    logger.debug(`Presigned URL hostname does not look like a standard R2 host: ${hostname}`);
  }

  return parsedUrl;
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
  logger.debug(`Starting PUT upload to presigned URL. Size: ${buffer.length} bytes, Content-Type: ${contentType}`);
  
  const uploadResponse = await axios.put(presignedUrl, buffer, {
    headers: {
      'Content-Type': contentType,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    // Use a separate timeout for the actual upload if needed, 
    // but here we rely on the global axios or the one passed in.
  });

  logger.debug(`PUT upload completed with status: ${uploadResponse.status}`);
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
  logger.debug(`uploadFileDirectly called for file: ${filePath}`);
  
  // This is a mock check to allow testing of a 500 server error.
  if (project === 'fail-me-500') {
    logger.debug('Mock 500 failure triggered by project name');
    throw new ApiError('The deployment service encountered an internal error.', 500);
  }

  if (!fs.existsSync(filePath)) {
    logger.debug(`File not found: ${filePath}`);
    throw new Error(`File not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = file.fileName || 'storybook.zip';
  const contentType = file.contentType || 'application/zip';

  try {
    const presigned = await requestPresignedUrl(apiClient, { project, version }, { fileName, contentType });
    const upload = await putToPresignedUrl(presigned.url, fileBuffer, contentType);
    return { success: true, url: presigned.url, status: upload.status, visibility: presigned.visibility };
  } catch (error) {
    logger.debug(`Upload failed. Error type: ${error.constructor.name}, Message: ${error.message}`);
    const details = getAxiosErrorDetails(error, apiClient.defaults.baseURL);
    if (details.kind === 'response') {
      logger.debug(`Error response status: ${details.statusCode}`);
    } else if (details.kind === 'request') {
      logger.debug(`Error request details: ${details.message}`);
    }
    throw new ApiError(`Failed to upload file: ${details.message}`, details.statusCode);
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

  logger.info(`Uploading coverage report for ${projectName}/${versionName}...`);
  logger.debug(`Uploading coverage report for ${projectName}/${versionName}`);

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

    logger.debug(`Coverage upload response status: ${response.status}`);
    logger.info(`Coverage report upload complete (status ${response.status}).`);
    return {
      success: response.data?.success ?? true,
      buildId: response.data?.buildId,
      coverageUrl: response.data?.coverageUrl,
    };
  } catch (error) {
    logger.debug(`Coverage upload failed. Message: ${error.message}`);
    const details = getAxiosErrorDetails(error, apiClient.defaults.baseURL);

    if (
      details.statusCode === 404 &&
      error.response?.data &&
      typeof error.response.data === 'object' &&
      String(error.response.data.error || '').includes('Build not found')
    ) {
      logger.error('Coverage upload failed with 404: Build not found for this version.');
      logger.info('This is not a missing-secret error. The production Worker did not find a Firestore build record for the project + version you are attaching coverage to.');
      logger.info('Coverage requires an existing build record created by a prior build upload or presigned URL generation.');
      logger.info('Most common causes and fixes:');
      logger.info('1) Coverage called before build exists. Upload the build ZIP first (or call the presigned URL endpoint) and then upload coverage.');
      logger.info('2) Project/version mismatch. Coverage must use the same {project}/{version} as the build upload or presigned URL call.');
      logger.info('3) Firestore secrets present but invalid. A malformed FIREBASE_PRIVATE_KEY (missing literal \\n sequences) or wrong project ID can prevent build creation.');
      logger.info('4) Firestore integration disabled in prod. Ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, and FIRESTORE_SERVICE_ACCOUNT_ID are set.');
      logger.info('Recommended checks:');
      logger.info('- Trigger a production upload or presigned URL call first and verify it returns buildId/buildNumber (confirms Firestore created a build).');
      logger.info('- Then call the coverage endpoint for the same project/version.');
      logger.info('- If upload does not return buildId/buildNumber, fix Firestore secrets and ensure FIREBASE_PRIVATE_KEY preserves literal \\n as documented.');
      logger.info('See README.md and docs/PRODUCTION_SETUP.md for details.');
    }

    throw new ApiError(`Failed to upload coverage: ${details.message}`, details.statusCode);
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
  logger.debug('uploadBuild orchestration started');
  const zipUpload = await uploadFileDirectly(apiClient, target, options.zipPath, {
    fileName: 'storybook.zip',
    contentType: 'application/zip',
  });

  let coverageUpload = null;
  if (options.coverageReport) {
    logger.info(`Waiting ${COVERAGE_UPLOAD_DELAY_MS / 1000}s before uploading coverage report...`);
    await sleep(COVERAGE_UPLOAD_DELAY_MS);

    try {
      coverageUpload = await uploadCoverageReportDirectly(apiClient, target, options.coverageReport);
    } catch (error) {
      logger.info('Coverage upload failed; retrying in 60s...');
      await sleep(COVERAGE_RETRY_DELAY_MS);
      coverageUpload = await uploadCoverageReportDirectly(apiClient, target, options.coverageReport);
    }
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
