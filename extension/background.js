const HOST_NAME = 'com.ccs.host';

console.log('[CCS Background] Service worker loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only handle messages targeted at background
  if (request.target !== 'background') return false;

  console.log('[CCS Background] Received:', request.message?.action);

  // Check if native messaging is available
  if (typeof chrome.runtime.sendNativeMessage !== 'function') {
    console.error('[CCS Background] Native messaging not available');
    sendResponse({
      success: false,
      error: 'Native messaging not available. Is the browser installed correctly (not as snap)?'
    });
    return true;
  }

  // Forward to native host
  chrome.runtime.sendNativeMessage(HOST_NAME, request.message, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[CCS Background] Native error:', chrome.runtime.lastError.message);
      sendResponse({
        success: false,
        error: chrome.runtime.lastError.message
      });
    } else {
      console.log('[CCS Background] Native response:', response?.success);
      sendResponse(response);
    }
  });

  // Keep channel open for async response
  return true;
});
