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

// 👉 You already have these
// const { sendEmail } = require("../utils/email");
// const github = require("../utils/github");
// const { analyzeWithGroq } = require("../utils/groq"); // your existing LLM logic

exports.handlePush = async (req, res, next) => {
  const requestId = Date.now(); // simple trace id

  console.log(`\n==============================`);
  console.log(`🚀 [${requestId}] PUSH WEBHOOK RECEIVED`);
  console.log(`==============================`);

  try {
    console.log(`[${requestId}] Headers:`, {
      event: req.headers["x-github-event"],
      delivery: req.headers["x-github-delivery"],
      contentType: req.headers["content-type"],
    });

    console.log(`[${requestId}] Raw body keys:`, Object.keys(req.body || {}));

    const payload = req.body;

    const repo = payload.repository?.full_name;
    const headCommit = payload.head_commit;
    const commitId = headCommit?.id;

    console.log(`[${requestId}] Repo:`, repo);
    console.log(`[${requestId}] Commit ID:`, commitId);

    if (!repo || !commitId) {
      console.error(`[${requestId}] ❌ Invalid payload`);
      return res.status(400).json({ ok: false, message: "Invalid payload" });
    }

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      console.error(`[${requestId}] ❌ Missing GITHUB_TOKEN`);
      throw new Error("Missing GITHUB_TOKEN");
    }

    const [owner, repoName] = repo.split("/");

    console.log(`[${requestId}] Fetching commit from GitHub...`);

    // 🔥 STEP 1: GitHub API
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
      console.error(`[${requestId}] ❌ GitHub API FAILED`);
      console.error("Status:", err.response?.status);
      console.error("Data:", err.response?.data);
      console.error("Message:", err.message);
      throw err;
    }

    const files = commitRes.data.files || [];

    console.log(`[${requestId}] Files changed:`, files.length);

    if (files.length === 0) {
      console.warn(`[${requestId}] ⚠️ No files in commit`);
      return res.json({ ok: true, message: "No files to analyze" });
    }

    // 🔥 STEP 2: Build diff
    let combinedDiff = "";

    for (const file of files) {
      console.log(`[${requestId}] Processing file:`, file.filename);

      combinedDiff += `\n\nFILE: ${file.filename}\n`;
      combinedDiff += file.patch || "No diff available";
    }

    console.log(`[${requestId}] Diff size:`, combinedDiff.length);

    // 🔥 STEP 3: LLM CALL
    let issues = [];
    try {
      console.log(`[${requestId}] Sending to Groq...`);

      issues = await analyzeWithGroq(combinedDiff);

      console.log(`[${requestId}] LLM Response:`, issues);
    } catch (err) {
      console.error(`[${requestId}] ❌ Groq FAILED`);
      console.error(err.message);
      throw err;
    }

    const authorEmail =
      headCommit?.author?.email || "default@email.com";

    console.log(`[${requestId}] Author email:`, authorEmail);

    // 🔥 STEP 4: Issues found
    if (issues && issues.length > 0) {
      console.log(`[${requestId}] 🚨 Issues detected:`, issues.length);

      const title = `🚨 AI Code Review Issues`;

      const body = [
        `Repo: ${repo}`,
        `Commit: ${commitId}`,
        `\nIssues:\n`,
        ...issues.map(
          (i) =>
            `- [${i.severity || "unknown"}] ${i.file}: ${i.issue}`
        ),
      ].join("\n");

      // 👉 Create GitHub Issue
      try {
        console.log(`[${requestId}] Creating GitHub issue...`);

        await github.createIssue(repo, title, body, token);

        console.log(`[${requestId}] ✅ GitHub issue created`);
      } catch (err) {
        console.error(`[${requestId}] ❌ Issue creation failed`);
        console.error(err.message);
      }

      // 👉 Send Email
      try {
        console.log(`[${requestId}] Sending email...`);

        await sendEmail(authorEmail, "Issues found", body);

        console.log(`[${requestId}] ✅ Email sent`);
      } catch (err) {
        console.error(`[${requestId}] ❌ Email failed`);
        console.error(err.message);
      }

      return res.json({ ok: false, issues });
    }

    // 🔥 STEP 5: No issues
    console.log(`[${requestId}] ✅ No issues found`);

    try {
      await sendEmail(
        authorEmail,
        "Commit looks good",
        `Commit ${commitId} passed all checks`
      );

      console.log(`[${requestId}] ✅ Success email sent`);
    } catch (err) {
      console.error(`[${requestId}] ❌ Email failed`);
      console.error(err.message);
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
