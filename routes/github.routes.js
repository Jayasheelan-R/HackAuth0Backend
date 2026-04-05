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
router.post("/push", verifyToken, handlePush);

module.exports = router;