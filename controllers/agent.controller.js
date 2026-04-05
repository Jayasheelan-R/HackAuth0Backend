const { getGitHubToken } = require("../services/auth.service");
const { generatePRReview } = require("../services/ai.service");
const github = require("../services/github.service");
const { sendEmail } = require("../services/email.service");

exports.runAgent = async (req, res, next) => {
  try {
    const { repo } = req.body;
    const token = await getGitHubToken(req.user.sub);

    const prs = await github.listPRs(repo, token);
    const pr = prs.data[0];

    const files = await github.getPRFiles(repo, pr.number, token);

    const code = files.data.map(f => f.patch).join("\n").slice(0, 8000);

    const review = await generatePRReview(code, pr.title, pr.body);

    const decision = review.includes("bug") ? "CHANGES REQUIRED ❌" : "APPROVED ✅";

    await github.postComment(pr.comments_url, review, token);
    await sendEmail(req.user.email, decision);

    res.json({ decision });

  } catch (err) {
    next(err);
  }
};