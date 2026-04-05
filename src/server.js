const app = require("./app");
const { ENV } = require("../config/env");

app.listen(ENV.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${ENV.PORT}`);
});