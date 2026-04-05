const axios = require("axios");
const { ENV } = require("../config/env");

exports.getManagementToken = async () => {
  const res = await axios.post(
    `https://${ENV.AUTH0_DOMAIN}/oauth/token`,
    {
      client_id: ENV.AUTH0_CLIENT_ID,
      client_secret: ENV.AUTH0_CLIENT_SECRET,
      audience: `https://${ENV.AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    }
  );
  return res.data.access_token;
};

exports.getGitHubToken = async (userId) => {
  const mgmtToken = await exports.getManagementToken();

  const res = await axios.get(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/credentials`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  const githubCredential = res.data.find(
    (c) => c.credential_type === "access_token" && c.name === "github"
  );

  if (!githubCredential) {
    throw new Error("GitHub token not found in Token Vault. User must connect GitHub via Auth0 Social Connection.");
  }

  const tokenRes = await axios.get(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/credentials/${githubCredential.id}`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  const accessToken = tokenRes.data.token;

  if (!accessToken) {
    throw new Error("Token Vault returned empty token for GitHub");
  }

  return accessToken;
};

exports.listUserCredentials = async (userId) => {
  const mgmtToken = await exports.getManagementToken();

  const res = await axios.get(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/credentials`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  return res.data.map((c) => ({
    id: c.id,
    name: c.name,
    credential_type: c.credential_type,
    scopes: c.scopes || [],
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
};

exports.revokeCredential = async (userId, credentialId) => {
  const mgmtToken = await exports.getManagementToken();

  await axios.delete(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/credentials/${credentialId}`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  return { revoked: true, credentialId };
};
