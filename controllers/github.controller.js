const { getGitHubToken } = require("../services/auth.service");
const github = require("../services/github.service");
const { generatePRReview } = require("../services/ai.service");
const { sendEmail } = require("../services/email.service");
const fs = require("fs");
const path = require("path");

exports.createIssue = async (req, res, next) => {
  try {
    const { repo, title, body } = req.body;

    const token = await getGitHubToken(req.user.sub);

    const r = await github.createIssue(repo, title, body, token);

    res.json(r.data);
  } catch (err) {
    next(err);
  }
};

exports.reviewPR = async (req, res, next) => {
  try {
    const { repo, prNumber } = req.body;

    const token = await getGitHubToken(req.user.sub);

    const pr = await github.getPR(repo, prNumber, token);

    const files = await github.getPRFiles(repo, prNumber, token);

    const code = files.data
      .map(f => f.patch)
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000);

    const review = await generatePRReview(
      code,
      pr.data.title,
      pr.data.body
    );

    await github.postComment(pr.data.comments_url, review, token);

    res.json({ review });
  } catch (err) {
    next(err);
  }
};

// Handle GitHub push webhook: check changed files for obvious errors.
// If bad code is found, create an issue and notify commit authors.
// Assumptions:
// - The pushed repository files are available on disk at process.env.PUSH_REPO_PATH
//   or at process.cwd(). If that's not the case, the analysis will skip file reads.
const axios = require("axios");

// your utils
// const { sendEmail } = require("../utils/email");
// const github = require("../utils/github");
// const { analyzeWithGroq } = require("../utils/groq");

exports.handlePush = async (req, res, next) => {
  const requestId = Date.now();

  console.log(`\n==============================`);
  console.log(`🚀 [${requestId}] PUSH WEBHOOK RECEIVED`);
  console.log(`==============================`);

  try {
    console.log(`[${requestId}] Headers:`, {
      event: req.headers["x-github-event"],
      contentType: req.headers["content-type"],
    });

    console.log(`[${requestId}] Raw body:`, req.body);

    // 🔥 HANDLE BOTH JSON + FORM PAYLOAD
    let payload = req.body;

    if (payload && payload.payload) {
      try {
        payload = JSON.parse(payload.payload);
        console.log(`[${requestId}] ✅ Parsed form payload`);
      } catch (e) {
        console.error(`[${requestId}] ❌ Payload parse failed`, e.message);
        return res.status(400).json({ ok: false, message: "Invalid payload" });
      }
    }

    console.log(`[${requestId}] Payload keys:`, Object.keys(payload || {}));

    const repo = payload.repository?.full_name;
    const headCommit = payload.head_commit;
    const commitId = headCommit?.id;

    console.log(`[${requestId}] Repo:`, repo);
    console.log(`[${requestId}] Commit:`, commitId);

    if (!repo || !commitId) {
      console.error(`[${requestId}] ❌ Missing repo or commit`);
      return res.status(400).json({ ok: false, message: "Invalid payload data" });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("Missing GITHUB_TOKEN");
    }

    const [owner, repoName] = repo.split("/");

    // 🔥 FETCH COMMIT DATA
    console.log(`[${requestId}] Fetching commit from GitHub...`);

    let commitRes;
    try {
      commitRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/commits/${commitId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
    } catch (err) {
      console.error(`[${requestId}] ❌ GitHub API error`);
      console.error("Status:", err.response?.status);
      console.error("Data:", err.response?.data);
      throw err;
    }

    const files = commitRes.data.files || [];

    console.log(`[${requestId}] Files changed:`, files.length);

    if (files.length === 0) {
      return res.json({ ok: true, message: "No files to analyze" });
    }

    // 🔥 BUILD DIFF
    let combinedDiff = "";

    for (const file of files) {
      console.log(`[${requestId}] File:`, file.filename);

      combinedDiff += `\n\nFILE: ${file.filename}\n`;
      combinedDiff += file.patch || "No diff";
    }

    console.log(`[${requestId}] Diff length:`, combinedDiff.length);

    // 🔥 LLM CALL
    let issues = [];
    try {
      console.log(`[${requestId}] Calling Groq...`);

      issues = await analyzeWithGroq(combinedDiff);

      console.log(`[${requestId}] LLM result:`, issues);
    } catch (err) {
      console.error(`[${requestId}] ❌ Groq error`, err.message);
      throw err;
    }

    const authorEmail =
      headCommit?.author?.email || "default@email.com";

    // 🔥 IF ISSUES
    if (issues && issues.length > 0) {
      console.log(`[${requestId}] 🚨 Issues found:`, issues.length);

      const title = `🚨 AI Review Issues`;

      const body = [
        `Repo: ${repo}`,
        `Commit: ${commitId}`,
        `\nIssues:\n`,
        ...issues.map(
          (i) =>
            `- [${i.severity || "unknown"}] ${i.file}: ${i.issue}`
        ),
      ].join("\n");

      // create issue
      try {
        await github.createIssue(repo, title, body, token);
        console.log(`[${requestId}] ✅ Issue created`);
      } catch (err) {
        console.error(`[${requestId}] ❌ Issue failed`, err.message);
      }

      // send mail
      try {
        await sendEmail(authorEmail, "Issues found", body);
        console.log(`[${requestId}] ✅ Email sent`);
      } catch (err) {
        console.error(`[${requestId}] ❌ Email failed`, err.message);
      }

      return res.json({ ok: false, issues });
    }

    // 🔥 NO ISSUES
    console.log(`[${requestId}] ✅ No issues`);

    try {
      await sendEmail(
        authorEmail,
        "Commit looks good",
        `Commit ${commitId} passed all checks`
      );
    } catch (err) {
      console.error(`[${requestId}] ❌ Email failed`, err.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(`\n[${requestId}] 💥 FATAL ERROR`);
    console.error(err.stack || err.message);

    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
};
