"use strict";

// Worker process lifecycle only. No game-account access or network automation.
if (process.send) {
  const beat = () => {
    if (process.connected) process.send({ type: "heartbeat", at: new Date().toISOString() });
  };
  beat();
  const timer = setInterval(beat, 5000);
  const stop = () => {
    clearInterval(timer);
    if (process.connected) process.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} else {
  process.exit(1);
}
