/**
 * Cookie Inspector – background.js (Service Worker, Manifest V3)
 *
 * Responsibilities:
 *  - Keep the service worker alive just enough for cookie permission
 *  - No persistent listeners needed for this extension's core functionality;
 *    all cookie reading is done directly in popup.js via chrome.cookies API.
 *
 * This file satisfies the Manifest V3 "background.service_worker" requirement.
 */

'use strict';

// Listen for install event – nothing special needed
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Cookie Inspector] Extension installed successfully.');
  } else if (details.reason === 'update') {
    console.log('[Cookie Inspector] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// Optional: respond to messages from popup if needed in the future
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'ping') {
    sendResponse({ type: 'pong', version: chrome.runtime.getManifest().version });
    return true;
  }
  // Return false to indicate we won't respond asynchronously for other messages
  return false;
});
