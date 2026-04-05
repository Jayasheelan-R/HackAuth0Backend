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
    `https://${ENV.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${mgmtToken}` } }
  );

  const github = res.data.identities.find(i => i.provider === "github");

  if (!github?.access_token) {
    throw new Error("GitHub not connected");
  }

  return github.access_token;
};