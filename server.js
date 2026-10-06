const app = require("./app");

const { PORT } = require("./config/env");
const { startReminderJob } = require("./services/reminderService");
const { startEmailQueueJob } = require("./services/emailQueueService");

app.listen(PORT, "0.0.0.0", () => {

    console.log(`PetFlow rodando na porta ${PORT}.`);
    startReminderJob();
    startEmailQueueJob();
    require("./services/reservationService").start();

});
