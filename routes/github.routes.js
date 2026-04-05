const express = require("express");
const {
  createIssue,
  reviewPR,
  handlePush,
} = require("../controllers/github.controller");

const { verifyToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/issue", verifyToken, createIssue);
router.post("/review", verifyToken, reviewPR);
// GitHub will POST webhooks without a user JWT. Keep this route public and
// verify webhook signatures in the future for security (recommended).
router.post("/push", handlePush);

module.exports = router;