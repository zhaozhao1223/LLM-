chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "SEND_TO_BACKEND") {

    fetch("http://127.0.0.1:8000/analyze/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comments: message.payload
      })
    })
    .then(async res => {
      if (!res.ok) {
        throw new Error(`Backend request failed with status ${res.status}`);
      }
      return res.json();
    })
    .then(data => {

      sendResponse({ success: true });

      chrome.tabs.sendMessage(sender.tab.id, {
        type: "BACKEND_RESULT",
        payload: data
      });

    })
    .catch(err => {
      console.error("Failed to send request:", err);
      sendResponse({ success: false });
    });

    return true;
  }

  if (message.type === "FETCH_HISTORY") {
    const page = message.page || 1;
    const pageSize = message.pageSize || 20;
    fetch(`http://127.0.0.1:8000/analyze/history?page=${page}&page_size=${pageSize}`)
      .then(async res => {
        if (!res.ok) {
          throw new Error(`Backend request failed with status ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        sendResponse({ success: true });
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "HISTORY_RESULT",
          payload: data
        });
      })
      .catch(err => {
        console.error("Failed to fetch analysis history:", err);
        sendResponse({ success: false });
      });
    return true;
  }

  if (message.type === "FETCH_ANALYSIS_DETAIL") {
    fetch(`http://127.0.0.1:8000/analyze/${message.id}`)
      .then(res => res.json())
      .then(data => {
        sendResponse({ success: true });
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "ANALYSIS_DETAIL_RESULT",
          payload: data
        });
      })
      .catch(err => {
        console.error("Failed to fetch analysis detail:", err);
        sendResponse({ success: false });
      });
    return true;
  }

});