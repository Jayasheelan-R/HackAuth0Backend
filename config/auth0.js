const jwksClient = require("jwks-rsa");
const { ENV } = require("./env");

const client = jwksClient({
  jwksUri: `https://${ENV.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

exports.getKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    callback(null, key.getPublicKey());
  });
};