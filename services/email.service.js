const { resend } = require("../config/resend");

exports.sendEmail = async (email, decision, subject = "Notification") => {
  if (!resend || !email) return;

  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: email,
    subject: subject,
    html: `<h3>${decision}</h3>`,
  });
};