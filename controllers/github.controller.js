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
exports.handlePush = async (req, res, next) => {
  try {
    // Basic request-level logging to help debug webhook 401s and payload problems.
    console.log("handlePush: webhook received", {
      path: req.path,
      method: req.method,
      // log key GitHub headers (don't print entire headers to avoid secrets)
      github_event: req.headers["x-github-event"] || req.headers["x-hub-event"],
      has_signature: !!(req.headers["x-hub-signature-256"] || req.headers["x-hub-signature"]),
      user_present: !!req.user,
      ip: req.ip,
    });

  const payload = req.body || {};
  // Use the safe `payload` reference instead of directly accessing `req.body` to
  // avoid runtime errors when `req.body` is undefined in some environments.
  const repo = (payload.repository && payload.repository.full_name) || payload.repo;

    const commits = Array.isArray(payload.commits) ? payload.commits : [];

    const changedFiles = new Set();
    const authorEmails = new Set();

    for (const c of commits) {
      if (c.added) c.added.forEach(f => changedFiles.add(f));
      if (c.modified) c.modified.forEach(f => changedFiles.add(f));
      if (c.removed) c.removed && c.removed.forEach(f => changedFiles.add(f));
      if (c.author && c.author.email) authorEmails.add(c.author.email);
      if (c.committer && c.committer.email) authorEmails.add(c.committer.email);
    }

  const repoPath = process.env.PUSH_REPO_PATH || process.cwd();

  console.log(`handlePush: repo=${repo || '<unknown>'}, commits=${commits.length}, repoPath=${repoPath}`);

    const issues = [];

    for (const filePath of changedFiles) {
      const abs = path.resolve(repoPath, filePath);
      let content;
      try {
        content = fs.readFileSync(abs, "utf8");
      } catch (err) {
        // If file isn't present on disk we skip deep analysis, but note it.
        console.warn("handlePush: file not available on disk", { file: filePath, abs, message: err && err.message });
        issues.push({ file: filePath, message: `file not available on disk: ${err.message}` });
        continue;
      }

      // Simple heuristics / lightweight checks
      try {
        if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
          // Attempt to detect syntax errors by using Function (simple check)
          try {
            // Wrap in function to avoid top-level import/export errors — still catches many syntax errors.
            new Function(content);
          } catch (e) {
            console.warn("handlePush: syntax detected", { file: filePath, message: e && e.message });
            issues.push({ file: filePath, message: `syntax error: ${e.message}` });
            continue;
          }
        }

        // Generic heuristics (dangerous patterns)
        if (/\beval\s*\(/.test(content)) {
          issues.push({ file: filePath, message: "usage of eval() detected" });
        }
        if (/process\.exit\s*\(/.test(content)) {
          issues.push({ file: filePath, message: "usage of process.exit() detected" });
        }
        // TODO/FIXME markers may indicate incomplete code
        if (/TODO|FIXME/.test(content)) {
          issues.push({ file: filePath, message: "TODO/FIXME marker found" });
        }
      } catch (err) {
        console.error("handlePush: analysis error", { file: filePath, message: err && err.message });
        issues.push({ file: filePath, message: `analysis error: ${err.message}` });
      }
    }

    if (issues.length > 0) {
      // Create an issue describing the problems
      try {
        // Try to obtain a GitHub token only if an authenticated user context is present.
        let token;
        if (req.user && req.user.sub) {
          try {
            token = await getGitHubToken(req.user.sub);
          } catch (tErr) {
            console.warn("handlePush: getGitHubToken failed", tErr && tErr.message);
          }
        } else {
          console.log("handlePush: no authenticated user provided for token retrieval; skipping createIssue with token");
        }

        const title = `Automated: Problems found in pushed code (${new Date().toISOString()})`;

        const bodyLines = [
          `The automated push-checker detected potential problems in the recent push to ${repo || "<unknown>"}.`,
          "\nDetected issues:\n",
        ];

        for (const it of issues) {
          bodyLines.push(`- ${it.file}: ${it.message}`);
        }

        const body = bodyLines.join("\n");

        if (repo && token) {
          try {
            await github.createIssue(repo, title, body, token);
            console.log("handlePush: created GitHub issue in", repo);
          } catch (createErr) {
            console.warn("handlePush: failed to create GitHub issue", createErr && createErr.message);
          }
        } else if (repo && !token) {
          console.log("handlePush: skipping GitHub issue creation because no token is available");
        }

        // Notify commit authors by email (best-effort)
        const decision = `Automated push check found ${issues.length} issue(s).`;
        for (const email of authorEmails) {
          try {
            await sendEmail(email, decision, `Automated push check — ${repo || "repo"}`);
          } catch (err) {
            // swallow email errors — notification is best-effort
            console.warn("sendEmail failed for", email, err && err.message);
          }
        }
      } catch (err) {
        // If creating issue / sending email fails, still report detection
        console.error("handlePush: failed to create issue or send mail:", err && err.message);
      }

      return res.json({ ok: false, issues });
    }

    // No issues found — respond success
    console.log("handlePush: no issues detected");
    return res.json({ ok: true, message: "No issues detected" });
  } catch (err) {
    next(err);
  }
};
