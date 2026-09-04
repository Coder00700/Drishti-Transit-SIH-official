// Build-time feature boundary, not a secret or an authorization check.
// The cloud API independently denies undeployed operations.
export const CLOUD_DEPLOYMENT = import.meta.env.VITE_DEPLOYMENT_MODE === 'cloud';
export const MONGO_CONTRIBUTORS = CLOUD_DEPLOYMENT || import.meta.env.VITE_CONTRIBUTOR_BACKEND === 'mongodb';
