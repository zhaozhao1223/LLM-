console.log("[Content] Content script started");

let commentBlocks = [];
let blockIndex = 1;

chrome.storage.local.get(["commentBlocks"], (res) => {

  if (res.commentBlocks) {
    commentBlocks = res.commentBlocks;

    if (commentBlocks.length > 0) {
      blockIndex = Math.max(...commentBlocks.map(b => b.id)) + 1;
    }

    window.postMessage({
      type: "BLOCKS_UPDATE",
      data: commentBlocks.map(b => ({
        id: b.id,
        count: b.comments.length
      }))
    }, "*");
  }
});


window.addEventListener("message", (event) => {

  if (event.source !== window) return;

  if (event.data?.type === "COMMENTS_CAPTURED") {

    const comments = event.data.data || [];
    if (comments.length === 0) return;

    // Keep only one block for the current page.
    // Merge newly captured comments into this block and remove duplicates.
    if (commentBlocks.length === 0) {
      commentBlocks = [{
        id: 1,
        comments: []
      }];
      blockIndex = 2;
    }

    const existing = commentBlocks[0].comments || [];
    const mergedMap = new Map();

    [...existing, ...comments].forEach(c => {
      const key = c.id || `${c.user_id || ""}-${c.text || ""}-${c.created_at || ""}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, c);
      }
    });

    commentBlocks[0].comments = Array.from(mergedMap.values());

    chrome.storage.local.set({ commentBlocks });

    window.postMessage({
      type: "BLOCKS_UPDATE",
      data: commentBlocks.map(b => ({
        id: b.id,
        count: b.comments.length,
        comments: b.comments,
        preview: b.comments.slice(0, 20).map(c => c.text)
      }))
    }, "*");
  }


  if (event.data?.type === "REQUEST_ANALYSIS") {
    const selectedIds = event.data.blocks || [];
    const directComments = Array.isArray(event.data.comments) ? event.data.comments : [];

    let selectedComments = directComments;

    // Fallback for older requests that only send block ids.
    if (!selectedComments.length) {
      selectedComments = commentBlocks
        .filter(b => selectedIds.includes(Number(b.id)) || selectedIds.includes(String(b.id)))
        .flatMap(b => b.comments || []);
    }

    if (selectedComments.length === 0) {
      console.warn("[Content] No comments available for analysis", {
        selectedIds,
        currentBlocks: commentBlocks.map(b => ({
          id: b.id,
          count: b.comments?.length || 0
        }))
      });

      window.postMessage({
        type: "ANALYSIS_ERROR",
        message: "No comments are available for analysis yet. Please wait for comments to finish loading."
      }, "*");

      return;
    }

    console.log("[Content] Sending comments to backend", {
      commentCount: selectedComments.length
    });

    chrome.runtime.sendMessage({
      type: "SEND_TO_BACKEND",
      payload: selectedComments
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Content] Failed to send analysis request:", chrome.runtime.lastError.message);

        window.postMessage({
          type: "ANALYSIS_ERROR",
          message: chrome.runtime.lastError.message
        }, "*");
        return;
      }

      if (response && response.success === false) {
        window.postMessage({
          type: "ANALYSIS_ERROR",
          message: "Backend analysis request failed."
        }, "*");
      }
    });
  }

  if (event.data?.type === "CLEAR_CACHE") {
    clearCache();
  }

  if (event.data?.type === "REQUEST_HISTORY") {
    chrome.runtime.sendMessage({
      type: "FETCH_HISTORY",
      page: event.data.page || 1,
      pageSize: event.data.pageSize || 20
    });
  }

  if (event.data?.type === "REQUEST_ANALYSIS_DETAIL") {
    chrome.runtime.sendMessage({
      type: "FETCH_ANALYSIS_DETAIL",
      id: event.data.id
    });
  }

  if (event.source !== window) return;
  if (event.data?.type === 'REQUEST_VISUAL_URL') {
      const analysisData = event.data.data;
      if (analysisData !== undefined && analysisData !== null) {
          chrome.storage.local.set({ analysisData: analysisData }, () => {
              const visualUrl = chrome.runtime.getURL('visual.html');
              window.postMessage({
                  type: 'RESPONSE_VISUAL_URL',
                  url: visualUrl
              }, '*');
          });
      } else {
          const visualUrl = chrome.runtime.getURL('visual.html');
          window.postMessage({
              type: 'RESPONSE_VISUAL_URL',
              url: visualUrl
          }, '*');
      }
  }

});

chrome.runtime.onMessage.addListener((message) => {

  if (message.type === "BACKEND_RESULT") {

    window.postMessage({
      type: "ANALYSIS_RESULT",
      data: message.payload
    }, "*");
  }

  if (message.type === "CLEAR_CACHE") {
    clearCache();
  }

  if (message.type === "HISTORY_RESULT") {
    window.postMessage({
      type: "HISTORY_RESULT",
      data: message.payload
    }, "*");
  }

  if (message.type === "ANALYSIS_DETAIL_RESULT") {
    window.postMessage({
      type: "ANALYSIS_DETAIL_RESULT",
      data: message.payload
    }, "*");
  }

});

function clearCache() {
  commentBlocks = [];
  blockIndex = 1;
  
  chrome.storage.local.remove(["commentBlocks"], () => {
    console.log("[Content] Cache cleared");
    
    window.postMessage({
      type: "BLOCKS_UPDATE",
      data: []
    }, "*");
    
    window.postMessage({
      type: "CACHE_CLEARED",
      data: { success: true }
    }, "*");
  });
}

(function inject() {
  const visualUrl = chrome.runtime.getURL('visual.html');
  window.postMessage({ type: 'SET_VISUAL_URL', url: visualUrl }, '*');

  const script = document.createElement("script");

  script.src = chrome.runtime.getURL("injected.js");

  script.onload = function () {
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);

})();

