const Groq = require("groq-sdk");
const { ENV } = require("./env");

exports.groq = new Groq({
  apiKey: ENV.GROQ_API_KEY,
});