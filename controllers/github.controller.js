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
  try {
    const payload = req.body;

    const repo = payload.repository?.full_name;
    const headCommit = payload.head_commit;
    const commitId = headCommit?.id;

    if (!repo || !commitId) {
      return res.status(400).json({ ok: false, message: "Invalid payload" });
    }

    console.log("Push received:", { repo, commitId });

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("Missing GITHUB_TOKEN");
    }

    // 🔥 STEP 1: Get commit details
    const [owner, repoName] = repo.split("/");

    const commitRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}/commits/${commitId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    const files = commitRes.data.files || [];

    if (files.length === 0) {
      console.log("No changed files");
      return res.json({ ok: true, message: "No files to analyze" });
    }

    // 🔥 STEP 2: Prepare diff for LLM
    let combinedDiff = "";

    for (const file of files) {
      combinedDiff += `\n\nFILE: ${file.filename}\n`;
      combinedDiff += file.patch || "No diff available";
    }

    console.log("Sending diff to LLM...");

    // 🔥 STEP 3: Run Groq (your existing function)
    const issues = await analyzeWithGroq(combinedDiff);

    // Expected format:
    // [
    //   { file: "...", issue: "...", severity: "low|medium|high" }
    // ]

    const authorEmail =
      headCommit?.author?.email || "default@email.com";

    // 🔥 STEP 4: If issues found
    if (issues && issues.length > 0) {
      console.log("Issues found:", issues.length);

      const title = `🚨 AI Code Review: Issues detected in latest push`;

      const body = [
        `Repository: ${repo}`,
        `Commit: ${commitId}`,
        `\nDetected Issues:\n`,
        ...issues.map(
          (i) => `- [${i.severity?.toUpperCase() || "UNKNOWN"}] ${i.file}: ${i.issue}`
        ),
      ].join("\n");

      // 👉 Create GitHub issue
      try {
        await github.createIssue(repo, title, body, token);
        console.log("GitHub issue created");
      } catch (err) {
        console.warn("Failed to create issue:", err.message);
      }

      // 👉 Send email
      try {
        await sendEmail(
          authorEmail,
          `⚠️ Issues found in your commit`,
          body
        );
      } catch (err) {
        console.warn("Email failed:", err.message);
      }

      return res.json({ ok: false, issues });
    }

    // 🔥 STEP 5: No issues → success mail
    console.log("No issues found");

    try {
      await sendEmail(
        authorEmail,
        `✅ Commit looks good`,
        `Your latest commit (${commitId}) passed all automated checks.`
      );
    } catch (err) {
      console.warn("Email failed:", err.message);
    }

    return res.json({ ok: true, message: "No issues detected" });
  } catch (err) {
    console.error("handlePush error:", err.message);
    next(err);
  }
};
