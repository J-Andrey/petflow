"use strict";
const { createSessionMiddleware } = require("../services/sessionService");
module.exports = createSessionMiddleware({
    db: require("../database/connection"), secret: require("../config/env").JWT_SECRET, type: "customer"
});
