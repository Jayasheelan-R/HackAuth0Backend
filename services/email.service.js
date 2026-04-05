const { resend } = require("../config/resend");

exports.sendEmail = async (email, decision, subject = "Notification") => {
  if (!email) {
    console.warn("sendEmail: no recipient provided");
    return;
  }

  if (!resend) {
    console.warn("sendEmail: Resend not configured. Email not sent to", email);
    return { skipped: true, dev: true, to: email, subject, body: decision };
  }

  try {
    const resp = await resend.emails.send({
      from: process.env.NOTIFY_EMAIL,
      to: email,
      subject,
      html: `<h3>${decision}</h3>`,
    });
    console.log("sendEmail: sent to", email, { resp });
    return resp;
  } catch (err) {
    console.error("sendEmail: failed to send to", email, err && err.message);
    throw err;
  }
};
