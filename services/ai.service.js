const { groq } = require("../config/groq");

exports.generatePRReview = async (code, title, desc) => {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: "Strict senior DevOps engineer." },
      {
        role: "user",
        content: `Review PR:\n${title}\n${desc}\n\n${code}`,
      },
    ],
  });

  return res.choices[0].message.content;
};