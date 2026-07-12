// @ts-check
/**
 * config.js — live-poll config for the beauty-contest tool (see SETUP.md).
 * Committed on purpose: the database URL is public by design; all security
 * lives in the Firebase Realtime Database rules.
 */
export default {
  databaseURL: 'https://ckontz-fin30600-default-rtdb.firebaseio.com',
  // Short typed-in join URL shown on the projector (a redirect page in the
  // cg89x.github.io repo forwards /play to this tool's submit.html). The QR
  // code still deep-links directly with the session code.
  shortJoinUrl: 'christiankontz.com/play',
};
