# R2 Credential Length Error - Diagnostic Guide

## 🔴 The Problem

You're encountering this error:
```
ApiError: Failed to upload file: 400 Bad Request - 
"Credential access key has length 39, should be 32"
```

## 🎯 Root Cause

**The backend Cloudflare Worker service has R2 credentials with incorrect length.**

Cloudflare R2 requires:
- **Access Key ID**: Exactly **32 hexadecimal characters** (e.g., `a1b2c3d4e5f6789012345678901234ab`)
- **Secret Access Key**: Variable length (typically 64+ characters)

The error occurs because the backend service at [`https://storybook-deployment-service.epinnock.workers.dev`](https://storybook-deployment-service.epinnock.workers.dev) is using a 39-character access key instead of 32.

## 🔍 Where the Error Occurs

```
Client (scry-node) 
    ↓ uploads ZIP
Backend Worker (storybook-deployment-service)
    ↓ generates presigned URL with INVALID credentials
Cloudflare R2 
    ❌ rejects with "Credential access key has length 39, should be 32"
```

## ✅ How to Fix

### Option 1: Fix Backend Worker Credentials (Recommended)

1. **Access Cloudflare Dashboard**
   - Go to your Cloudflare Workers dashboard
   - Find the worker: `storybook-deployment-service`

2. **Update Environment Variables**
   - Navigate to: Workers > `storybook-deployment-service` > Settings > Variables
   - Check these variables:
     - `CLOUDFLARE_ACCESS_KEY_ID` - should be exactly 32 hex chars
     - `CLOUDFLARE_SECRET_ACCESS_KEY` - should be 64+ chars
     - `R2_BUCKET_NAME` - your bucket name

3. **Generate New R2 API Token** (if needed)
   - Go to: R2 > Manage R2 API Tokens
   - Click "Create API Token"
   - Set permissions (Read & Write recommended)
   - Copy the credentials:
     - Access Key ID (32 hex characters)
     - Secret Access Key (64+ characters)
   - **⚠️ Save these immediately - you can't view the secret again!**

4. **Update Worker Environment Variables**
   - Paste the new credentials into your worker's environment
   - Deploy the worker

### Option 2: Test Your Local Credentials First

Before fixing the backend, verify your local credentials are correct:

```bash
# Run the diagnostic test script
node newscripts/test-credentials-and-upload.cjs
```

This script will:
- ✅ Validate your credential lengths
- ✅ Test R2 bucket access
- ✅ Perform a test file upload
- ✅ Confirm your credentials work correctly

### Option 3: Use Direct R2 Upload

If you can't access the backend worker, you can temporarily bypass it:

```javascript
// Use the R2Uploader directly instead of the deployment service
const R2Uploader = require('./newscripts/r2-upload.cjs');

const uploader = new R2Uploader({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET_NAME
});

await uploader.uploadFile('./my-file.zip', 'uploads/my-file.zip');
```

## 🧪 Testing & Validation

### 1. Test Your Local Credentials
```bash
node newscripts/test-credentials-and-upload.cjs
```

### 2. Test R2 Presigned URL Generation
```bash
node newscripts/test-r2-presigned.cjs
```

### 3. Validate Credential Format

Valid Access Key ID:
- ✅ Length: Exactly 32 characters
- ✅ Format: Hexadecimal (0-9, a-f)
- ✅ Example: `a1b2c3d4e5f6789012345678901234ab`

Invalid Access Key ID:
- ❌ Length: 39 characters (like in your error)
- ❌ Contains non-hex characters
- ❌ Too short or too long

## 📝 Environment Variables Reference

Your `.env` file should contain:

```bash
# Cloudflare R2 Configuration
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_ACCESS_KEY_ID=32_hex_chars_here
CLOUDFLARE_SECRET_ACCESS_KEY=64plus_chars_here
R2_BUCKET_NAME=your_bucket_name
R2_BASE_PATH=https://your_account_id.r2.cloudflarestorage.com
```

## 🔐 Security Best Practices

1. **Never commit credentials** to version control
2. **Use environment variables** for all sensitive data
3. **Rotate credentials** periodically
4. **Use least-privilege access** - only grant necessary permissions
5. **Store credentials securely** - use a password manager or secrets vault

## 📚 Additional Resources

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 API Tokens Guide](https://developers.cloudflare.com/r2/api/s3/tokens/)
- [AWS S3 API Compatibility](https://developers.cloudflare.com/r2/api/s3/)

## 🆘 Still Having Issues?

If you've verified your credentials and still see the error:

1. **Check the backend worker logs**
   - Cloudflare Dashboard > Workers > `storybook-deployment-service` > Logs

2. **Verify the worker code**
   - Check how credentials are loaded from environment variables
   - Look for any `.trim()` or string manipulation that might affect length

3. **Create new API tokens**
   - Sometimes tokens can be corrupted during creation
   - Generate fresh tokens from Cloudflare dashboard

4. **Test with curl**
   ```bash
   curl -X POST https://storybook-deployment-service.epinnock.workers.dev/presigned-url/test/v1/test.zip \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json"
   ```

## 💡 Summary

The error is in the **backend service**, not your client code. The backend worker at `https://storybook-deployment-service.epinnock.workers.dev` needs to have its R2 credentials updated to use a properly formatted 32-character hexadecimal access key ID.