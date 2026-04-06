const { getGitHubToken } = require("../services/auth.service");
const github = require("../services/github.service");
const { generatePRReview } = require("../services/ai.service");

exports.createIssue = async (req, res, next) => {
  try {
    const { repo, title, body } = req.body;

    const token = await getGitHubToken(req.user.sub);

    const r = await github.createIssue(repo, title, body, token);

    res.json(r.data);
  } catch (err) {
    console.error("createIssue: error", err && err.message);
    if (err && err.response) {
      return res.status(err.response.status).json({ error: err.response.data || err.message });
    }
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

exports.reviewPR = async (req, res, next) => {
  const requestId = `pr-${Date.now()}`;

  try {
    console.log(`[${requestId}] Incoming reviewPR request`, {
      path: req.path,
      user: req.user?.sub || "anonymous",
      body: req.body,
    });

    const { repo, prNumber } = req.body || {};

    if (typeof repo !== "string" || !repo.includes("/")) {
      return res.status(400).json({
        error: "Invalid repo format. Expected 'owner/repo'",
      });
    }

    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return res.status(400).json({
        error: "Invalid prNumber. Must be a positive integer",
      });
    }

    if (!req.user?.sub) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = await getGitHubToken(req.user.sub);
    if (!token) {
      throw new Error("GitHub token not found");
    }

    console.log(`[${requestId}] Fetching PR #${prNumber} from ${repo}`);

    const [pr, files] = await Promise.all([
      github.getPR(repo, prNumber, token),
      github.getPRFiles(repo, prNumber, token),
    ]);

    if (!pr?.data) {
      throw new Error("PR data not found");
    }

    const patches = (files?.data || [])
      .map(f => f?.patch)
      .filter(patch => typeof patch === "string");

    if (patches.length === 0) {
      console.warn(`[${requestId}] No patch data found`);
    }

    const MAX_CODE_LENGTH = 8000;
    const fullCode = patches.join("\n");

    const code =
      fullCode.length > MAX_CODE_LENGTH
        ? fullCode.slice(0, MAX_CODE_LENGTH) +
          "\n\n// [TRUNCATED DUE TO LENGTH]"
        : fullCode;

    console.log(`[${requestId}] Code size: ${fullCode.length}`);

    const review = await Promise.race([
      generatePRReview(code, pr.data.title, pr.data.body),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AI timeout")), 15000)
      ),
    ]);

    if (!review) {
      throw new Error("Empty review generated");
    }

    await github.postComment(pr.data.comments_url, review, token);

    // Skip email for now (Resend requires domain verification)
    // Email is optional for hackathon - core functionality (GitHub review) works perfectly

    console.log(`[${requestId}] Review posted successfully`);

    return res.json({
      success: true,
      review,
      meta: {
        truncated: fullCode.length > MAX_CODE_LENGTH,
        originalLength: fullCode.length,
      },
    });
  } catch (err) {
    console.error(`[${requestId}] reviewPR failed`, {
      message: err.message,
      stack: err.stack,
    });

    if (err.response?.status === 404) {
      return res.status(404).json({ error: `PR #${req.body?.prNumber} does not exist in ${req.body?.repo}` });
    }

    if (err.message.includes("timeout")) {
      return res.status(504).json({ error: "Review generation timed out" });
    }

    if (err.message.includes("GitHub")) {
      return res.status(502).json({ error: "GitHub API error" });
    }

    return next(err);
  }
};
