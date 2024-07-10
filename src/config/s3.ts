import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

function checkAWSCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS credentials are missing. Please set AWS_ACCESS_KEY and AWS_SECRET_KEY environment variables.'
    );
  }

  return { accessKeyId, secretAccessKey };
}

let s3Client: S3Client;
try {
  const { accessKeyId, secretAccessKey } = checkAWSCredentials();
  s3Client = new S3Client({
    region: 'ap-southeast-1',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
} catch (error) {
  console.error('Error initializing S3 client:', error);
  process.exit(1);
}

export {s3Client};