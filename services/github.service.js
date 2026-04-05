const axios = require("axios");

exports.listPRs = (repo, token) =>
  axios.get(`https://api.github.com/repos/${repo}/pulls`, {
    headers: { Authorization: `Bearer ${token}` },
  });

exports.getPR = (repo, prNumber, token) =>
  axios.get(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

exports.getPRFiles = (repo, prNumber, token) =>
  axios.get(`https://api.github.com/repos/${repo}/pulls/${prNumber}/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });

exports.postComment = (url, body, token) =>
  axios.post(url, { body }, {
    headers: { Authorization: `Bearer ${token}` },
  });

exports.createIssue = (repo, title, body, token) =>
  axios.post(
    `https://api.github.com/repos/${repo}/issues`,
    { title, body },
    { headers: { Authorization: `Bearer ${token}` } }
  );