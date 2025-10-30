const { Client } = require('minio');

const s3 = new Client({
  endPoint: process.env.S3_ENDPOINT || 'localhost',
  port: Number(process.env.S3_PORT || 9000),
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
  useSSL: (process.env.S3_USE_SSL || 'false') === 'true'
});

async function ensureBucket(bucket: string) {
  const exists = await s3.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await s3.makeBucket(bucket, 'us-east-1');
  }
}

module.exports = { s3, ensureBucket };

