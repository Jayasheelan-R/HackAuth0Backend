const jwt = require("jsonwebtoken");
const { getKey } = require("../config/auth0");
const { ENV } = require("../config/env");

exports.verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  jwt.verify(
    token,
    getKey,
    {
      issuer: `https://${ENV.AUTH0_DOMAIN}/`,
      audience: "https://my-api",
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) return res.status(401).json({ error: "Invalid token" });
      req.user = decoded;
      next();
    }
  );
};