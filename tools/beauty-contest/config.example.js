// @ts-check
/**
 * config.example.js — template for the beauty-contest live-poll config.
 *
 * To enable live play: follow SETUP.md, then
 *   cp config.example.js config.js
 * and paste your Firebase Realtime Database URL below. config.js IS meant to
 * be committed — the URL is public by design; all security lives in the
 * database rules (see SETUP.md). Without config.js the instructor page runs
 * in simulation mode and the student page reports the game as unconfigured.
 */
export default {
  databaseURL: 'https://YOUR-PROJECT-default-rtdb.firebaseio.com',
  // Optional: a short typed-in join URL to display on the projector instead
  // of the full submit.html address (set up a redirect page on your domain;
  // the QR code always deep-links directly). Omit to show the full URL.
  // shortJoinUrl: 'yourdomain.com/play',
};
