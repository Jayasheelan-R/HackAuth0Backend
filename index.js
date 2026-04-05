// =========================
// IMPORTS
// =========================
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const axios = require("axios");
const Groq = require("groq-sdk");
const { Resend } = require("resend");

dotenv.config();

// =========================
// BASIC SETUP
// =========================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 6000;

// =========================
// AUTH0 SETUP
// =========================
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    callback(null, key.getPublicKey());
  });
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  jwt.verify(
    token,
    getKey,
    {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: "https://my-api",
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        console.error("JWT ERROR:", err.message);
        return res.status(401).json({ error: "Invalid token" });
      }
      req.user = decoded;
      next();
    }
  );
}

// =========================
// AUTH0 TOKEN VAULT
// =========================
async function getManagementToken() {
  const res = await axios.post(
    `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
    {
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: "client_credentials",
    }
  );

  return res.data.access_token;
}

async function getGitHubToken(userId) {
  const mgmtToken = await getManagementToken();

  const res = await axios.get(
    `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${mgmtToken}` },
    }
  );

  const github = res.data.identities.find(i => i.provider === "github");

  if (!github?.access_token) {
    throw new Error("GitHub not connected");
  }

  return github.access_token;
}

// =========================
// GROQ SETUP
// =========================
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function generatePRReview(code, title, desc) {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are a strict senior DevOps engineer.",
      },
      {
        role: "user",
        content: `
Review this PR:

Title: ${title}
Description: ${desc}

Code:
${code}

Give:
- Bugs
- Improvements
- Security issues
- Final verdict (APPROVE / CHANGES REQUIRED)
        `,
      },
    ],
    temperature: 0.3,
  });

  return res.choices[0].message.content;
}

// =========================
// EMAIL (SAFE MODE)
// =========================
let resend = null;

if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

async function sendEmail(email, decision) {
  try {
    if (!resend || !email) return;

    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "AI PR Review Result",
      html: `<h3>Decision: ${decision}</h3>`,
    });
  } catch (err) {
    console.log("Email skipped");
  }
}

// =========================
// ROUTES
// =========================

// Health
app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

// Test
app.post("/test", verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// =========================
// CREATE ISSUE
// =========================
app.post("/create-issue", verifyToken, async (req, res) => {
  try {
    const { repo, title, body } = req.body;

    const token = await getGitHubToken(req.user.sub);

    const r = await axios.post(
      `https://api.github.com/repos/${repo}/issues`,
      { title, body },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(r.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// REVIEW PR (MANUAL)
// =========================
app.post("/review-pr", verifyToken, async (req, res) => {
  try {
    const { repo, prNumber } = req.body;

    const token = await getGitHubToken(req.user.sub);

    const pr = await axios.get(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const files = await axios.get(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/files`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

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

    await axios.post(
      pr.data.comments_url,
      { body: review },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({ review });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// 🤖 AGENT MODE (FINAL)
// =========================
app.post("/agent-review", verifyToken, async (req, res) => {
  try {
    const { repo } = req.body;

    const token = await getGitHubToken(req.user.sub);

    // 1. Get latest PR
    const prs = await axios.get(
      `https://api.github.com/repos/${repo}/pulls`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (prs.data.length === 0) {
      return res.json({ message: "No PRs found" });
    }

    const pr = prs.data[0];

    // 2. Get code changes
    const files = await axios.get(
      pr.url + "/files",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const code = files.data
      .map(f => f.patch)
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000);

    console.log("🤖 Agent reviewing PR...");

    // 3. AI Review
    const review = await generatePRReview(code, pr.title, pr.body);

    // 4. Decision logic
    let decision = "APPROVED ✅";

    if (
      review.toLowerCase().includes("bug") ||
      review.toLowerCase().includes("security")
    ) {
      decision = "CHANGES REQUIRED ❌";
    }

    const finalComment = `
${review}

----------------------
🚦 Decision: ${decision}
`;

    // 5. Post to GitHub
    await axios.post(
      pr.comments_url,
      { body: finalComment },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // 6. Email (optional)
    await sendEmail(req.user.email, decision);

    res.json({
      message: "Agent executed successfully 🚀",
      decision,
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Running on http://localhost:${PORT}`);
});