const express = require("express");
const cors = require("cors");

const agentRoutes = require("../routes/agent.routes");
const githubRoutes = require("../routes/github.routes");
const healthRoutes = require("../routes/health.routes");

const { errorHandler } = require("../middleware/error.middleware");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/", healthRoutes);
app.use("/agent", agentRoutes);
app.use("/github", githubRoutes);

// Global error handler
app.use(errorHandler);

module.exports = app;