const { groq } = require("../config/groq");

exports.generatePRReview = async (code, title, desc) => {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `
You are a strict senior DevOps engineer reviewing pull requests.

You MUST follow this EXACT output format. Do NOT deviate. Do NOT add extra text.

Bugs:
- If bugs exist, list them clearly.
- If no bugs, write: No bugs.

Code improvements:
- List improvements.
- If none, write: No improvements needed.

Security issues:
- List issues.
- If none, write: No security issues.

Performance suggestions:
- List suggestions.
- If none, write: No performance issues.

Final verdict:
- One clear decision: Approved / बदलाव required / Rejected.
- Brief reason (1–2 lines max).
`
      },
      {
        role: "user",
        content: `Review PR:

Title: ${title}
Description: ${desc}

Code:
${code}`
      }
    ],
    temperature: 0.2, // lower = more consistent structure
  });

  return res.choices[0].message.content;
};