const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth.middleware");
const { listUserCredentials, revokeCredential } = require("../services/auth.service");
const agentController = require("../controllers/agent.controller");

router.post("/review", verifyToken, agentController.runAgent);

router.get("/credentials", verifyToken, async (req, res) => {
  try {
    const credentials = await listUserCredentials(req.user.sub);
    res.json({ credentials });
  } catch (err) {
    console.error("Token Vault list error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/credentials/:credentialId", verifyToken, async (req, res) => {
  try {
    const result = await revokeCredential(req.user.sub, req.params.credentialId);
    res.json(result);
  } catch (err) {
    console.error("Token Vault revoke error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
