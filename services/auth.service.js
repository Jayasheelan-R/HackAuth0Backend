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

const getUser = async (userId, mgmtToken) => {
  const res = await axios.get(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );
  return res.data;
};

exports.getGitHubToken = async (userId) => {
  const mgmtToken = await exports.getManagementToken();
  const user = await getUser(userId, mgmtToken);

  const github = (user.identities || []).find((i) => i.provider === "github");

  if (!github?.access_token) {
    throw new Error("GitHub not connected. User must link GitHub via Auth0 Social Connection.");
  }

  return github.access_token;
};

exports.listUserCredentials = async (userId) => {
  const mgmtToken = await exports.getManagementToken();
  const user = await getUser(userId, mgmtToken);

  return (user.identities || []).map((i) => ({
    provider: i.provider,
    user_id: i.user_id,
    connection: i.connection,
    isSocial: i.isSocial,
  }));
};

exports.revokeCredential = async (userId, provider, providerId) => {
  const mgmtToken = await exports.getManagementToken();

  await axios.delete(
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/identities/${provider}/${providerId}`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  return { revoked: true, provider, providerId };
};
