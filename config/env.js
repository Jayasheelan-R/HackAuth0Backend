require("dotenv").config();

exports.ENV = {
  PORT: process.env.PORT || 6000,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};