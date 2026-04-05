const express = require("express");
const { runAgent } = require("../controllers/agent.controller");
const { verifyToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/review", verifyToken, runAgent);

module.exports = router;