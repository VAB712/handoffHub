export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMailScheduler } = await import("./lib/mail-scheduler");
    startMailScheduler();
  }
}
