const { Resend } = require("resend");
const { ENV } = require("./env");

exports.resend = ENV.RESEND_API_KEY
  ? new Resend(ENV.RESEND_API_KEY)
  : null;